import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  docData,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, combineLatest, firstValueFrom, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { CardsService } from './cards.service';
import { CardStatementsService } from './card-statements.service';
import { WalletsService, WalletView } from './wallets.service';
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
  private wallets = inject(WalletsService);
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
  readonly reminders$: Observable<Reminder[]> = combineLatest([this.cards.cards$, this.statements.statements$, this.wallets.views$]).pipe(
    map(([cards, statements, wallets]) => [...NotificationsService.computeReminders(cards, statements), ...NotificationsService.walletReminders(wallets)]),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Reminder keys already shown on the Notifications page (users/{uid}.notifSeen.reminders).
   * A reminder's key changes when it escalates (due soon → overdue), so it alerts once more then.
   */
  readonly seenReminderKeys$: Observable<Set<string>> = this.auth
    .forUser(
      uid => docData(doc(this.firestore, 'users', uid)).pipe(map(d => new Set<string>(((d as any)?.notifSeen?.reminders ?? []) as string[]))),
      new Set<string>()
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /**
   * Bell badge = things you haven't seen yet: unread activity + reminders not yet viewed.
   * Pending reviews are NOT added here — the Review tab shows that count, and the "N new items to
   * review" notification already announces them (counting both made one email show up twice).
   */
  readonly badgeCount$: Observable<number> = combineLatest([this.stored$, this.reminders$, this.seenReminderKeys$]).pipe(
    map(([stored, reminders, seen]) => stored.filter(n => !n.read).length + reminders.filter(r => !seen.has(r.key)).length)
  );

  /** Called when the Notifications page has been looked at: everything on it counts as seen. */
  async markViewed(reminders: Reminder[], stored: AppNotification[]): Promise<void> {
    const uid = this.auth.requireUid();
    await setDoc(
      doc(this.firestore, 'users', uid),
      // Replaces the list: reminders that no longer exist drop out, so it never grows.
      { uid, notifSeen: { reminders: reminders.map(r => r.key).slice(0, 200), at: serverTimestamp() } },
      { merge: true }
    );
    await this.markAllRead(stored);
  }

  /**
   * Opening the page a notification points to counts as reading it: visiting Review clears
   * "N new items to review", visiting Gmail clears "Reconnect …". Never throws.
   */
  async markReadOnVisit(link: string): Promise<void> {
    try {
      const stored = await firstValueFrom(this.stored$);
      await this.markAllRead(stored.filter(n => n.link === link));
    } catch (err) {
      console.warn('[Notifications] mark read on visit failed', err);
    }
  }

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
            key: `due-${s.id}-${d.days < 0 ? 'overdue' : d.tone}`,
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
          key: `exp-${card.id}-${exp.days < 0 ? 'expired' : 'soon'}`,
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

  /** Wallets below their warning amount. The key holds the threshold, so changing it can alert again. */
  static walletReminders(wallets: WalletView[]): Reminder[] {
    return wallets
      .filter(w => w.low)
      .map(w => ({
        key: `wallet-low-${w.id}-${w.lowBalanceAlert}`,
        type: 'wallet_low' as const,
        tone: w.balance <= 0 ? ('overdue' as const) : ('soon' as const),
        title: `Low balance · ${w.name}`,
        body: `₹${w.balance.toLocaleString('en-IN')} left — below your ₹${w.lowBalanceAlert.toLocaleString('en-IN')} warning. Top up before your next payment.`,
        date: new Date(),
        cardId: w.id,
        link: '/cards/wallets',
      }));
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
      origin: d.origin === 'demo' ? 'demo' : d.origin === 'client' ? 'client' : 'system',
      createdAt: toDate(d.createdAt),
      readAt: toDate(d.readAt),
    };
  }
}
