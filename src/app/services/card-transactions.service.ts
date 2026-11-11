import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';
import { SpendingService } from './spending.service';
import { CardTransaction, TransactionInput } from '../models/card-transaction.model';
import { toDate } from '../utils/firestore.util';
import { monthRange } from '../utils/date-input.util';

@Injectable({ providedIn: 'root' })
export class CardTransactionsService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private spending = inject(SpendingService);
  private col = collection(this.firestore, 'card_transactions');

  /**
   * One month of transactions, newest first.
   * Needs composite index card_transactions(userId ASC, txnDate DESC) — in firestore.indexes.json.
   */
  byMonth$(month: string): Observable<CardTransaction[]> {
    const [start, end] = monthRange(month);
    return this.auth.forUser(
      uid =>
        collectionData(
          query(
            this.col,
            where('userId', '==', uid),
            where('txnDate', '>=', Timestamp.fromDate(start)),
            where('txnDate', '<', Timestamp.fromDate(end)),
            orderBy('txnDate', 'desc')
          ),
          { idField: 'id' }
        ).pipe(map(docs => docs.map(d => CardTransactionsService.fromFirestore(d)))),
      [] as CardTransaction[]
    );
  }

  async add(input: TransactionInput) {
    const ref = await addDoc(this.col, {
      ...CardTransactionsService.clean(input),
      userId: this.auth.requireUid(),
      source: 'manual',
      editedAfterReview: false,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    });
    if (input.direction === 'debit') void this.spending.afterSpend({ date: input.txnDate, amount: input.amount, cardId: input.cardId });
    return ref;
  }

  /** Editing an email-sourced transaction keeps its source + reviewId and flags the manual correction. */
  update(txn: CardTransaction, input: TransactionInput) {
    return updateDoc(doc(this.firestore, 'card_transactions', txn.id), {
      ...CardTransactionsService.clean(input),
      editedAfterReview: txn.source !== 'manual' ? true : txn.editedAfterReview,
      lastUpdated: serverTimestamp(),
    });
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'card_transactions', id));
  }

  static clean(input: TransactionInput) {
    return {
      cardId: input.cardId,
      txnDate: Timestamp.fromDate(input.txnDate),
      amount: Math.round(Number(input.amount) * 100) / 100,
      direction: input.direction,
      description: input.description.trim().slice(0, 120),
      category: (input.category ?? '').trim().slice(0, 30),
    };
  }

  static fromFirestore(d: any): CardTransaction {
    return {
      id: d.id,
      userId: d.userId,
      cardId: d.cardId,
      txnDate: toDate(d.txnDate) ?? new Date(),
      amount: Number(d.amount) || 0,
      direction: d.direction === 'credit' ? 'credit' : 'debit',
      description: d.description ?? '',
      category: d.category ?? '',
      source: d.source ?? 'manual',
      reviewId: d.reviewId ?? null,
      editedAfterReview: !!d.editedAfterReview,
      createdAt: toDate(d.createdAt),
      lastUpdated: toDate(d.lastUpdated),
    };
  }
}
