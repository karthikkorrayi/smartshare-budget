import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { ExtractedValues, ReviewItem } from '../models/review-item.model';
import { Card, CARD_UPDATABLE_FIELDS } from '../models/card.model';
import { CardTransactionsService } from './card-transactions.service';
import { CardStatementsService } from './card-statements.service';
import { datesToTimestamps, timestampsToDates, toDate } from '../utils/firestore.util';
import { statusFromPaid } from '../models/card-statement.model';
import { dayInMonth } from '../utils/date-input.util';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'review_items');

  /** Pending items, newest email first. Two equality filters → no composite index needed. */
  readonly pending$: Observable<ReviewItem[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.col, where('userId', '==', uid), where('status', '==', 'pending')), {
          idField: 'id',
        }).pipe(
          map(docs =>
            docs
              .map(d => ReviewService.fromFirestore(d))
              .sort((a, b) => (b.email.receivedAt?.getTime() ?? 0) - (a.email.receivedAt?.getTime() ?? 0))
          )
        ),
      [] as ReviewItem[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Last 30 decisions. Needs index review_items(userId ASC, status ASC, resolvedAt DESC). */
  readonly resolved$: Observable<ReviewItem[]> = this.auth.forUser(
    uid =>
      collectionData(
        query(
          this.col,
          where('userId', '==', uid),
          where('status', 'in', ['approved', 'rejected']),
          orderBy('resolvedAt', 'desc'),
          limit(30)
        ),
        { idField: 'id' }
      ).pipe(map(docs => docs.map(d => ReviewService.fromFirestore(d)))),
    [] as ReviewItem[]
  );

  /**
   * Approves an item: writes the verified record AND marks the review approved in ONE batch.
   * Firestore rules reject either write on its own, so unreviewed email data can never become verified.
   */
  async approve(item: ReviewItem, values: ExtractedValues, cardId: string, edited: boolean): Promise<void> {
    const uid = this.auth.requireUid();
    const batch = writeBatch(this.firestore);
    const reviewRef = doc(this.firestore, 'review_items', item.id);
    const source = item.origin === 'gmail' ? 'email' : 'demo';
    let targetId: string;

    if (item.kind === 'transaction') {
      const ref = doc(collection(this.firestore, 'card_transactions'));
      targetId = ref.id;
      batch.set(ref, {
        ...CardTransactionsService.clean({
          cardId,
          txnDate: values.txnDate ?? new Date(),
          amount: Number(values.amount) || 0,
          direction: values.direction ?? 'debit',
          description: values.description?.trim() || 'Card transaction',
          category: values.category ?? '',
        }),
        userId: uid,
        source,
        reviewId: item.id,
        editedAfterReview: false,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
      });
    } else if (item.kind === 'statement') {
      const ref = doc(collection(this.firestore, 'card_statements'));
      targetId = ref.id;
      const totalDue = Number(values.totalDue) || 0;
      batch.set(ref, {
        ...CardStatementsService.clean({
          cardId,
          statementDate: values.statementDate ?? new Date(),
          dueDate: values.dueDate ?? values.statementDate ?? new Date(),
          totalDue,
          minDue: Number(values.minDue) || 0,
          paidAmount: 0,
          status: statusFromPaid(totalDue, 0),
        }),
        userId: uid,
        source,
        reviewId: item.id,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
      });
    } else {
      targetId = cardId;
      const changes: Record<string, number> = {};
      for (const f of CARD_UPDATABLE_FIELDS) {
        const v = values[f];
        if (v !== undefined && v !== null && !isNaN(Number(v))) changes[f] = Math.trunc(Number(v));
      }
      batch.update(doc(this.firestore, 'cards', cardId), {
        ...changes,
        lastUpdated: serverTimestamp(),
        lastUpdateSource: 'review',
        lastReviewId: item.id,
      });
    }

    batch.update(reviewRef, {
      status: 'approved',
      cardId,
      targetId,
      edited,
      resolvedValues: datesToTimestamps(values),
      resolvedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  async reject(item: ReviewItem): Promise<void> {
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, 'review_items', item.id), {
      status: 'rejected',
      resolvedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  /**
   * Creates three sample review items (+ two sample notifications) for one card so the Review
   * flow can be tried before Gmail sync exists. Marked origin 'demo' everywhere.
   */
  async loadSamples(card: Card): Promise<void> {
    const uid = this.auth.requireUid();
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const stmt = dayInMonth(y, m - (now.getDate() >= card.statementDay ? 0 : 1), card.statementDay);
    const due = new Date(stmt.getFullYear(), stmt.getMonth(), stmt.getDate() + 18);
    const yesterday = new Date(y, m, now.getDate() - 1);
    const email = (subject: string, snippet: string, id: string) => ({
      account: 'sample@gmail.com',
      from: `alerts@${card.bankName.toLowerCase().replace(/[^a-z]/g, '') || 'bank'}.example`,
      subject,
      receivedAt: Timestamp.fromDate(now),
      messageId: `demo-${id}-${now.getTime()}`,
      snippet,
    });
    const base = {
      userId: uid,
      origin: 'demo',
      cardId: card.id,
      cardHint: { bankName: card.bankName, lastFourDigits: card.lastFourDigits },
      status: 'pending',
      createdAt: serverTimestamp(),
    };

    const batch = writeBatch(this.firestore);
    batch.set(doc(this.col), {
      ...base,
      kind: 'transaction',
      confidence: 0.92,
      extracted: datesToTimestamps({
        txnDate: yesterday,
        amount: 1249.5,
        direction: 'debit',
        description: 'AMAZON PAY INDIA',
        category: 'Shopping',
      }),
      email: email(
        `Alert: Transaction on card ending ${card.lastFourDigits}`,
        `Rs.1,249.50 spent on your card XX${card.lastFourDigits} at AMAZON PAY INDIA on ${yesterday.toDateString()}.`,
        'txn'
      ),
    });
    batch.set(doc(this.col), {
      ...base,
      kind: 'statement',
      confidence: 0.81,
      extracted: datesToTimestamps({ statementDate: stmt, dueDate: due, totalDue: 18450, minDue: 920 }),
      email: email(
        `Your credit card statement for card ending ${card.lastFourDigits}`,
        `Total amount due Rs.18,450.00, minimum amount due Rs.920.00, payment due date ${due.toDateString()}.`,
        'stmt'
      ),
    });
    const newDueDay = card.dueDay === 5 ? 7 : 5;
    batch.set(doc(this.col), {
      ...base,
      kind: 'card_update',
      confidence: 0.64,
      extracted: { dueDay: newDueDay },
      email: email(
        'Change in your payment due date',
        `Your card payment due date has been revised to the ${newDueDay}th of every month.`,
        'upd'
      ),
    });
    const n = (type: string, title: string, body: string) =>
      batch.set(doc(collection(this.firestore, 'notifications')), {
        userId: uid,
        type,
        title,
        body,
        cardId: card.id,
        link: '/cards/review',
        read: false,
        origin: 'demo',
        createdAt: serverTimestamp(),
      });
    n('new_transaction', 'New transaction found', `₹1,249.50 at AMAZON PAY INDIA on ••${card.lastFourDigits} — waiting for your review.`);
    n('statement_generated', 'New statement found', `Statement for ••${card.lastFourDigits}: ₹18,450 due — waiting for your review.`);
    await batch.commit();
  }

  static fromFirestore(d: any): ReviewItem {
    const e = d.email ?? {};
    return {
      id: d.id,
      userId: d.userId,
      kind: d.kind,
      origin: d.origin === 'gmail' ? 'gmail' : 'demo',
      cardId: d.cardId ?? null,
      cardHint: { bankName: d.cardHint?.bankName ?? '', lastFourDigits: d.cardHint?.lastFourDigits ?? '' },
      extracted: timestampsToDates<ExtractedValues>(d.extracted),
      confidence: Number(d.confidence) || 0,
      email: {
        account: e.account ?? '',
        from: e.from ?? '',
        subject: e.subject ?? '',
        receivedAt: toDate(e.receivedAt),
        messageId: e.messageId ?? '',
        snippet: e.snippet ?? '',
      },
      status: d.status ?? 'pending',
      createdAt: toDate(d.createdAt),
      resolvedAt: toDate(d.resolvedAt),
      resolvedValues: d.resolvedValues ? timestampsToDates<ExtractedValues>(d.resolvedValues) : null,
      edited: !!d.edited,
      targetId: d.targetId ?? null,
    };
  }
}
