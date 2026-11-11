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

  updateIncome(income: any) {
    const { id, userId, ...changes } = income;
    return updateDoc(doc(this.firestore, 'income', id), changes);
  }

  deleteIncome(id: string) {
    return deleteDoc(doc(this.firestore, 'income', id));
  }
}
