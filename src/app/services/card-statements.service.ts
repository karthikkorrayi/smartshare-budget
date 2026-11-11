import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { CardStatement, StatementInput, statusFromPaid } from '../models/card-statement.model';
import { toDate } from '../utils/firestore.util';

@Injectable({ providedIn: 'root' })
export class CardStatementsService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'card_statements');

  /** All statements, newest statement date first. Small collection (≈12 per card per year). */
  readonly statements$: Observable<CardStatement[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }).pipe(
          map(docs =>
            docs
              .map(d => CardStatementsService.fromFirestore(d))
              .sort((a, b) => b.statementDate.getTime() - a.statementDate.getTime())
          )
        ),
      [] as CardStatement[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  add(input: StatementInput) {
    return addDoc(this.col, {
      ...CardStatementsService.clean(input),
      userId: this.auth.requireUid(),
      source: 'manual',
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    });
  }

  update(id: string, input: StatementInput) {
    return updateDoc(doc(this.firestore, 'card_statements', id), {
      ...CardStatementsService.clean(input),
      lastUpdated: serverTimestamp(),
    });
  }

  markPaid(s: CardStatement) {
    return updateDoc(doc(this.firestore, 'card_statements', s.id), {
      paidAmount: s.totalDue,
      status: 'Paid',
      lastUpdated: serverTimestamp(),
    });
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'card_statements', id));
  }

  static clean(input: StatementInput) {
    const totalDue = Math.max(0, Math.round(Number(input.totalDue) * 100) / 100 || 0);
    const minDue = Math.min(totalDue, Math.max(0, Math.round(Number(input.minDue) * 100) / 100 || 0));
    const paidAmount = Math.max(0, Math.round(Number(input.paidAmount) * 100) / 100 || 0);
    return {
      cardId: input.cardId,
      statementDate: Timestamp.fromDate(input.statementDate),
      dueDate: Timestamp.fromDate(input.dueDate),
      totalDue,
      minDue,
      paidAmount,
      status: input.status ?? statusFromPaid(totalDue, paidAmount),
    };
  }

  static fromFirestore(d: any): CardStatement {
    return {
      id: d.id,
      userId: d.userId,
      cardId: d.cardId,
      statementDate: toDate(d.statementDate) ?? new Date(),
      dueDate: toDate(d.dueDate) ?? new Date(),
      totalDue: Number(d.totalDue) || 0,
      minDue: Number(d.minDue) || 0,
      paidAmount: Number(d.paidAmount) || 0,
      status: d.status ?? 'Unpaid',
      source: d.source ?? 'manual',
      reviewId: d.reviewId ?? null,
      createdAt: toDate(d.createdAt),
      lastUpdated: toDate(d.lastUpdated),
    };
  }
}
