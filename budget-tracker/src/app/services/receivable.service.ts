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
export class ReceivableService {
  firestore = inject(Firestore);

  add(data: any) {
    return addDoc(collection(this.firestore, 'receivables'), data);
  }

  getAll() {
    return collectionData(
      collection(this.firestore, 'receivables'),
      { idField: 'id' }
    );
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'receivables', id));
  }
}
