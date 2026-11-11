import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class UpcomingPaymentService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'upcoming_payments');

  add(payment: any) {
    return addDoc(this.col, { ...payment, userId: this.auth.requireUid() });
  }

  getAll(): Observable<any[]> {
    return this.auth.forUser(
      uid => collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }),
      []
    );
  }

  getByMonth(month: string): Observable<any[]> {
    return this.auth.forUser(
      uid =>
        collectionData(
          query(this.col, where('userId', '==', uid), where('month', '==', month)),
          { idField: 'id' }
        ),
      []
    );
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'upcoming_payments', id));
  }
}
