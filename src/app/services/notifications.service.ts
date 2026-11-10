import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { CardsService } from './cards.service';
import { CardStatementsService } from './card-statements.service';
import { ReviewService } from './review.service';
import { AppNotification, Reminder } from '../models/app-notification.model';
import { Card, cardLabel, expiryInfo, nextDueDate, nextStatementDate } from '../models/card.model';
import { CardStatement, dueInfo } from '../models/card-statement.model';
import { chunk, toDate } from '../utils/firestore.util';
import { daysBetween, relativeDays } from '../utils/date-input.util';

export const STATEMENT_HEADS_UP_DAYS = 3;
export const DUE_HEADS_UP_DAYS = 7;
export const EXPIRY_HEADS_UP_DAYS = 60;

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private cards = inject(CardsService);
  private statements = inject(CardStatementsService);
  private review = inject(ReviewService);
  private col = collection(this.firestore, 'notifications');

  /** Stored event notifications, newest first. Needs index notifications(userId ASC, createdAt DESC). */
  readonly stored$: Observable<AppNotification[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.col, where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(100)), {
          idField: 'id',
        }).pipe(map(docs => docs.map(d => NotificationsService.fromFirestore(d)))),
      [] as AppNotification[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Live reminders computed from cards + statements (never stored, never stale). */
  readonly reminders$: Observable<Reminder[]> = combineLatest([this.cards.cards$, this.statements.statements$]).pipe(
    map(([cards, statements]) => NotificationsService.computeReminders(cards, statements)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Badge count: unread notifications + reminders + pending reviews. */
  readonly badgeCount$: Observable<number> = combineLatest([this.stored$, this.reminders$, this.review.pending$]).pipe(
    map(([stored, reminders, pending]) => stored.filter(n => !n.read).length + reminders.length + pending.length)
  );

  markRead(n: AppNotification) {
    if (n.read) return Promise.resolve();
    return updateDoc(doc(this.firestore, 'notifications', n.id), { read: true, readAt: serverTimestamp() });
  }

  async markAllRead(list: AppNotification[]): Promise<void> {
    for (const part of chunk(list.filter(n => !n.read))) {
      const b = writeBatch(this.firestore);
      part.forEach(n => b.update(doc(this.firestore, 'notifications', n.id), { read: true, readAt: serverTimestamp() }));
      await b.commit();
    }
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'notifications', id));
  }

  async clearRead(list: AppNotification[]): Promise<void> {
    for (const part of chunk(list.filter(n => n.read))) {
      const b = writeBatch(this.firestore);
      part.forEach(n => b.delete(doc(this.firestore, 'notifications', n.id)));
      await b.commit();
    }
  }

  static computeReminders(cards: Card[], statements: CardStatement[], today = new Date()): Reminder[] {
    const out: Reminder[] = [];
    for (const card of cards.filter(c => c.status === 'Active')) {
      const label = cardLabel(card);

      // Statement generation coming up.
      const stmt = nextStatementDate(card, today);
      const stmtDays = daysBetween(today, stmt);
      if (stmtDays <= STATEMENT_HEADS_UP_DAYS) {
        out.push({
          key: `stmt-${card.id}-${stmt.getTime()}`,
          type: 'statement_upcoming',
          tone: 'soon',
          title: `Statement ${relativeDays(stmtDays)}`,
          body: `${label} generates its statement on ${stmt.toDateString()}.`,
          date: stmt,
          cardId: card.id,
          link: '/cards/statements',
        });
      }

      // Payment due: prefer real unpaid statements; fall back to the card's due day.
      const unpaid = statements.filter(s => s.cardId === card.id && s.status !== 'Paid');
      if (unpaid.length) {
        for (const s of unpaid) {
          const d = dueInfo(s, today);
          if (d.tone === 'ok') continue;
          out.push({
            key: `due-${s.id}`,
            type: d.days < 0 ? 'payment_overdue' : 'payment_due',
            tone: d.tone === 'overdue' ? 'overdue' : 'soon',
            title: d.days < 0 ? `Payment overdue · ${label}` : `Payment due ${relativeDays(d.days)} · ${label}`,
            body: `₹${d.outstanding.toLocaleString('en-IN')} outstanding (min ₹${s.minDue.toLocaleString('en-IN')}), due ${s.dueDate.toDateString()}.`,
            date: s.dueDate,
            cardId: card.id,
            link: '/cards/statements',
          });
        }
      } else {
        const due = nextDueDate(card, today);
        const dueDays = daysBetween(today, due);
        const hasRecentStatement = statements.some(s => s.cardId === card.id && daysBetween(s.statementDate, today) < 45);
        if (dueDays <= DUE_HEADS_UP_DAYS && !hasRecentStatement) {
          out.push({
            key: `dueday-${card.id}-${due.getTime()}`,
            type: 'payment_due',
            tone: dueDays <= 2 ? 'overdue' : 'soon',
            title: `Payment due ${relativeDays(dueDays)} · ${label}`,
            body: `Based on due day ${card.dueDay}. Add this cycle's statement to track the exact amount.`,
            date: due,
            cardId: card.id,
            link: '/cards/statements',
          });
        }
      }

      // Card expiry.
      const exp = expiryInfo(card, today);
      if (exp.days <= EXPIRY_HEADS_UP_DAYS) {
        out.push({
          key: `exp-${card.id}`,
          type: 'card_expiring',
          tone: exp.days < 0 ? 'overdue' : 'soon',
          title: exp.days < 0 ? `Card expired · ${label}` : `Card expires soon · ${label}`,
          body: exp.days < 0 ? `Expired ${exp.label}. Update the expiry once you get the new card.` : `${exp.text} (${exp.label}).`,
          date: new Date(card.expiryYear, card.expiryMonth, 0),
          cardId: card.id,
          link: '/cards',
        });
      }
    }
    return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'overdue' ? -1 : 1) || a.date.getTime() - b.date.getTime());
  }

  static fromFirestore(d: any): AppNotification {
    return {
      id: d.id,
      userId: d.userId,
      type: d.type,
      title: d.title ?? '',
      body: d.body ?? '',
      cardId: d.cardId ?? null,
      link: d.link ?? null,
      read: !!d.read,
      origin: d.origin === 'demo' ? 'demo' : 'system',
      createdAt: toDate(d.createdAt),
      readAt: toDate(d.readAt),
    };
  }
}
