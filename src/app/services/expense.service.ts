import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, of } from 'rxjs';
import { chunk } from '../utils/firestore.util';
import { AuthService } from './auth.service';
import { SpendingService } from './spending.service';

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private spending = inject(SpendingService);
  private col = collection(this.firestore, 'expenses');

  async addExpense(data: any) {
    const ref = await addDoc(this.col, { ...data, userId: this.auth.requireUid() });
    // Daily-limit warning (never blocks or fails the save).
    void this.spending.afterSpend({ date: data?.date instanceof Date ? data.date : new Date(), amount: Number(data?.amount) || 0 });
    return ref;
  }

  getExpenses(): Observable<any[]> {
    return this.auth.forUser(
      uid => collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }),
      []
    );
  }

  getExpensesByMonth(month: string): Observable<any[]> {
    return this.auth.forUser(
      uid =>
        collectionData(
          query(this.col, where('userId', '==', uid), where('month', '==', month)),
          { idField: 'id' }
        ),
      []
    );
  }

  /** Several months at once ('YYYY-MM' keys, any number; queried 30 at a time). */
  getExpensesByMonths(months: string[]): Observable<any[]> {
    if (!months.length) return of([]);
    return this.auth.forUser(
      uid =>
        combineLatest(
          chunk(months, 30).map(part =>
            collectionData(query(this.col, where('userId', '==', uid), where('month', 'in', part)), { idField: 'id' })
          )
        ).pipe(map(parts => parts.flat())),
      []
    );
  }

  /** Every entry linked to an account of this type (all time) — used for account balances. */
  linkedTo(accountType: 'bank' | 'wallet'): Observable<any[]> {
    return this.auth.forUser(
      uid => collectionData(query(this.col, where('userId', '==', uid), where('accountType', '==', accountType)), { idField: 'id' }),
      []
    );
  }

  updateExpense(expense: any) {
    // Never write the client-side `id` into the document, and never let an update change ownership.
    const { id, userId, ...changes } = expense;
    return updateDoc(doc(this.firestore, 'expenses', id), changes);
  }

  deleteExpense(id: string) {
    return deleteDoc(doc(this.firestore, 'expenses', id));
  }
}
