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
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'expenses');

  addExpense(data: any) {
    return addDoc(this.col, { ...data, userId: this.auth.requireUid() });
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

  updateExpense(expense: any) {
    // Never write the client-side `id` into the document, and never let an update change ownership.
    const { id, userId, ...changes } = expense;
    return updateDoc(doc(this.firestore, 'expenses', id), changes);
  }

  deleteExpense(id: string) {
    return deleteDoc(doc(this.firestore, 'expenses', id));
  }
}
