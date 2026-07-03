import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import {
  Firestore,
  collection,
  addDoc,
  collectionData,
  deleteDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy
} from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class ReceivableService {
  firestore = inject(Firestore);
  private auth = inject(AuthService);

  add(data: any) {
    return addDoc(collection(this.firestore, 'receivables'), { ...data, userId: this.auth.user()?.uid });
  }

  getAll() {
    return collectionData(
      query(collection(this.firestore, 'receivables'), where('userId', '==', this.auth.user()?.uid ?? '__anonymous__')),
      { idField: 'id' }
    );
  }

  getByMonth(month: string) {
    return collectionData(
      query(
        collection(this.firestore, 'receivables'),
        where('month', '==', month),
        where('userId', '==', this.auth.user()?.uid ?? '__anonymous__')
      ),
      { idField: 'id' }
    );
  }

  update(id: string, data: any) {
    const ref = doc(this.firestore, 'receivables', id);
    return updateDoc(ref, data);
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'receivables', id));
  }
}