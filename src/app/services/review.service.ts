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
import { EmailCategory, ExtractedValues, ReviewItem, ReviewKind } from '../models/review-item.model';
import { Card, CARD_UPDATABLE_FIELDS } from '../models/card.model';
import { CardTransactionsService } from './card-transactions.service';
import { CardStatementsService } from './card-statements.service';
import { datesToTimestamps, timestampsToDates, toDate } from '../utils/firestore.util';
import { statusFromPaid } from '../models/card-statement.model';
import { dayInMonth, monthKey } from '../utils/date-input.util';

export interface ApprovalInput {
  kind: ReviewKind;
  values: ExtractedValues;
  cardId: string | null;
  edited: boolean;
}

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

  /** Last 50 decisions. Needs index review_items(userId ASC, status ASC, resolvedAt DESC). */
  readonly resolved$: Observable<ReviewItem[]> = this.auth.forUser(
    uid =>
      collectionData(
        query(this.col, where('userId', '==', uid), where('status', 'in', ['approved', 'rejected']), orderBy('resolvedAt', 'desc'), limit(50)),
        { idField: 'id' }
      ).pipe(map(docs => docs.map(d => ReviewService.fromFirestore(d)))),
    [] as ReviewItem[]
  );

  /**
   * Approves an item: writes the verified record into its destination module AND marks the review
   * approved in ONE batch. Firestore rules reject either write on its own.
   */
  async approve(item: ReviewItem, a: ApprovalInput): Promise<void> {
    const uid = this.auth.requireUid();
    const v = a.values;
    const batch = writeBatch(this.firestore);
    const fromEmail = item.origin === 'gmail';
    const cardSource = fromEmail ? 'email' : 'demo';
    const imported = { importedFrom: fromEmail ? 'email' : 'demo', reviewId: item.id };
    const when = v.txnDate ?? item.email.receivedAt ?? new Date();
    let targetId: string;

    switch (a.kind) {
      case 'income': {
        const ref = doc(collection(this.firestore, 'income'));
        targetId = ref.id;
        batch.set(ref, {
          userId: uid,
          source: (v.description || 'Income').trim().slice(0, 120),
          amount: Number(v.amount) || 0,
          category: v.category ?? 'Other income',
          date: Timestamp.fromDate(when),
          month: monthKey(when),
          createdAt: serverTimestamp(),
          ...imported,
        });
        break;
      }
      case 'expense': {
        const ref = doc(collection(this.firestore, 'expenses'));
        targetId = ref.id;
        batch.set(ref, {
          userId: uid,
          description: (v.description || 'Expense').trim().slice(0, 120),
          amount: Number(v.amount) || 0,
          category: v.category ?? 'Others',
          date: Timestamp.fromDate(when),
          month: monthKey(when),
          ...imported,
        });
        break;
      }
      case 'bill': {
        const ref = doc(collection(this.firestore, 'upcoming_payments'));
        targetId = ref.id;
        const due = v.dueDate ?? when;
        batch.set(ref, {
          userId: uid,
          description: (v.description || 'Payment due').trim().slice(0, 120),
          amount: Number(v.amount ?? v.totalDue) || 0,
          category: v.category ?? 'Bills',
          dueDate: Timestamp.fromDate(due),
          month: monthKey(due),
          createdAt: serverTimestamp(),
          ...imported,
        });
        break;
      }
      case 'transaction': {
        const ref = doc(collection(this.firestore, 'card_transactions'));
        targetId = ref.id;
        batch.set(ref, {
          ...CardTransactionsService.clean({
            cardId: a.cardId!,
            txnDate: when,
            amount: Number(v.amount) || 0,
            direction: v.direction ?? 'debit',
            description: v.description?.trim() || 'Card transaction',
            category: v.category ?? '',
          }),
          userId: uid,
          source: cardSource,
          reviewId: item.id,
          editedAfterReview: false,
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
        });
        break;
      }
      case 'statement': {
        const ref = doc(collection(this.firestore, 'card_statements'));
        targetId = ref.id;
        const totalDue = Number(v.totalDue ?? v.amount) || 0;
        batch.set(ref, {
          ...CardStatementsService.clean({
            cardId: a.cardId!,
            statementDate: v.statementDate ?? when,
            dueDate: v.dueDate ?? v.statementDate ?? when,
            totalDue,
            minDue: Number(v.minDue) || 0,
            paidAmount: 0,
            status: statusFromPaid(totalDue, 0),
          }),
          userId: uid,
          source: cardSource,
          reviewId: item.id,
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
        });
        break;
      }
      case 'card_update': {
        targetId = a.cardId!;
        const changes: Record<string, number> = {};
        for (const f of CARD_UPDATABLE_FIELDS) {
          const x = v[f];
          if (x !== undefined && x !== null && !isNaN(Number(x))) changes[f] = Math.trunc(Number(x));
        }
        batch.update(doc(this.firestore, 'cards', a.cardId!), {
          ...changes,
          lastUpdated: serverTimestamp(),
          lastUpdateSource: 'review',
          lastReviewId: item.id,
        });
        break;
      }
    }

    batch.update(doc(this.firestore, 'review_items', item.id), {
      status: 'approved',
      kind: a.kind,
      cardId: KIND_NEEDS_CARD[a.kind] ? a.cardId : null,
      targetId,
      edited: a.edited,
      resolvedValues: datesToTimestamps(v),
      resolvedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  async reject(item: ReviewItem): Promise<void> {
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, 'review_items', item.id), { status: 'rejected', resolvedAt: serverTimestamp() });
    await batch.commit();
  }

  /** Approve several high-confidence items, one atomic batch each (a failure doesn't block the rest). */
  async approveMany(items: { item: ReviewItem; input: ApprovalInput }[]): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;
    for (const { item, input } of items) {
      try {
        await this.approve(item, input);
        ok++;
      } catch (e) {
        console.warn('[Review] bulk approve failed for', item.id, e);
        failed++;
      }
    }
    return { ok, failed };
  }

  /**
   * Sample review items that look like real Gmail results, so the whole flow can be tried
   * before (or without) connecting Gmail. Everything is marked origin 'demo'.
   */
  async loadSamples(card: Card | null): Promise<number> {
    const uid = this.auth.requireUid();
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = (days: number) => new Date(y, m, now.getDate() + days);
    let n = 0;
    const batch = writeBatch(this.firestore);

    const add = (kind: ReviewKind, category: EmailCategory, confidence: number, extracted: ExtractedValues, subject: string, snippet: string, from: string, withCard = false) => {
      n++;
      batch.set(doc(this.col), {
        userId: uid,
        origin: 'demo',
        kind,
        category,
        cardId: withCard && card ? card.id : null,
        cardHint: { bankName: withCard && card ? card.bankName : '', lastFourDigits: withCard && card ? card.lastFourDigits : '' },
        accountHint: withCard ? '' : '5678',
        extracted: datesToTimestamps(extracted),
        confidence,
        email: { account: 'sample@gmail.com', from, subject, receivedAt: Timestamp.fromDate(now), messageId: `demo-${n}-${now.getTime()}`, snippet },
        status: 'pending',
        createdAt: serverTimestamp(),
      });
    };

    add('income', 'salary_credit', 0.93, { txnDate: d(-1), amount: 85000, direction: 'credit', description: 'Salary · ACME TECH PVT LTD', category: 'Salary' },
      'Credit alert: A/c XX5678', 'Your A/c XX5678 is credited by Rs.85,000.00 by NEFT-SALARY ACME TECH PVT LTD.', 'alerts@samplebank.example');
    add('expense', 'bank_debit', 0.79, { txnDate: d(-2), amount: 350, direction: 'debit', description: 'zomato@paytm', category: 'Food' },
      'Transaction alert', 'Sent Rs.350.00 from A/c X5678 to zomato@paytm via UPI.', 'alerts@samplebank.example');
    add('bill', 'bill_generated', 0.71, { amount: 1845, dueDate: d(14), description: 'Electricity bill', category: 'Bills' },
      'Your electricity bill is generated', 'Bill amount Rs. 1,845.00. Due date in two weeks.', 'noreply@power.example');

    if (card) {
      const stmt = dayInMonth(y, m - (now.getDate() >= card.statementDay ? 0 : 1), card.statementDay);
      const due = new Date(stmt.getFullYear(), stmt.getMonth(), stmt.getDate() + 18);
      const from = `alerts@${card.bankName.toLowerCase().replace(/[^a-z]/g, '') || 'bank'}.example`;
      add('transaction', 'card_transaction', 0.92, { txnDate: d(-1), amount: 1249.5, direction: 'debit', description: 'AMAZON PAY INDIA', category: 'Shopping' },
        `Alert: transaction on card ending ${card.lastFourDigits}`, `Rs.1,249.50 spent on card XX${card.lastFourDigits} at AMAZON PAY INDIA.`, from, true);
      add('statement', 'card_statement', 0.84, { statementDate: stmt, dueDate: due, totalDue: 18450, minDue: 920 },
        `Statement for card ending ${card.lastFourDigits}`, 'Total amount due Rs.18,450.00, minimum amount due Rs.920.00.', from, true);
      add('card_update', 'card_update', 0.64, { dueDay: card.dueDay === 5 ? 7 : 5 },
        'Change in your payment due date', `Your payment due date has been revised to the ${card.dueDay === 5 ? 7 : 5}th of every month.`, from, true);
    }

    batch.set(doc(collection(this.firestore, 'notifications')), {
      userId: uid,
      type: 'review_pending',
      title: `${n} sample items to review`,
      body: 'Approve, edit or reject them to see where each one lands.',
      cardId: null,
      link: '/review',
      read: false,
      origin: 'demo',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return n;
  }

  static fromFirestore(d: any): ReviewItem {
    const e = d.email ?? {};
    return {
      id: d.id,
      userId: d.userId,
      kind: d.kind,
      category: d.category ?? null,
      origin: d.origin === 'gmail' ? 'gmail' : 'demo',
      connectionId: d.connectionId ?? null,
      cardId: d.cardId ?? null,
      cardHint: { bankName: d.cardHint?.bankName ?? '', lastFourDigits: d.cardHint?.lastFourDigits ?? '' },
      accountHint: d.accountHint ?? '',
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

const KIND_NEEDS_CARD: Record<ReviewKind, boolean> = {
  income: false,
  expense: false,
  bill: false,
  transaction: true,
  statement: true,
  card_update: true,
};
