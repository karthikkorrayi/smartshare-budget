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
export class ReceivableService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'receivables');

  add(data: any) {
    return addDoc(this.col, { ...data, userId: this.auth.requireUid() });
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

  update(id: string, data: any) {
    const { id: _id, userId, ...changes } = data ?? {};
    return updateDoc(doc(this.firestore, 'receivables', id), changes);
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'receivables', id));
  }
}
