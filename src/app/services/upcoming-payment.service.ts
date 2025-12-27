import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  collectionData,
  deleteDoc,
  doc
} from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class UpcomingPaymentService {
  firestore = inject(Firestore);

  add(payment: any) {
    return addDoc(collection(this.firestore, 'upcoming_payments'), payment);
  }

  getAll() {
    return collectionData(
      collection(this.firestore, 'upcoming_payments'),
      { idField: 'id' }
    );
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'upcoming_payments', id));
  }
}
