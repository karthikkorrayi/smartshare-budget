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

@Injectable({ providedIn: 'root' })
export class IncomeService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'income');

  addIncome(data: any) {
    return addDoc(this.col, { ...data, userId: this.auth.requireUid() });
  }

  getIncome(): Observable<any[]> {
    return this.auth.forUser(
      uid => collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }),
      []
    );
  }

  getIncomeByMonth(month: string): Observable<any[]> {
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
  getIncomeByMonths(months: string[]): Observable<any[]> {
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

  updateIncome(income: any) {
    const { id, userId, ...changes } = income;
    return updateDoc(doc(this.firestore, 'income', id), changes);
  }

  deleteIncome(id: string) {
    return deleteDoc(doc(this.firestore, 'income', id));
  }
}
