import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import {
  Firestore,
  collection,
  addDoc,
  collectionData,
  deleteDoc,
  doc,
  query,
  where
} from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class UpcomingPaymentService {
  firestore = inject(Firestore);
  private auth = inject(AuthService);

  add(payment: any) {
    return addDoc(collection(this.firestore, 'upcoming_payments'), { ...payment, userId: this.auth.user()?.uid });
  }

  getAll() {
    return collectionData(
      query(collection(this.firestore, 'upcoming_payments'), where('userId', '==', this.auth.user()?.uid ?? '__anonymous__')),
      { idField: 'id' }
    );
  }

  getByMonth(month: string) {
    return collectionData(
      query(
        collection(this.firestore, 'upcoming_payments'),
        where('month', '==', month),
        where('userId', '==', this.auth.user()?.uid ?? '__anonymous__')
      ),
      { idField: 'id' }
    );
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'upcoming_payments', id));
  }
}