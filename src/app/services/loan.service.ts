import { Injectable, inject } from '@angular/core';
import { Firestore, addDoc, collection, collectionData, deleteDoc, doc, query, serverTimestamp, updateDoc, where } from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { Loan, loanFrom } from '../models/loan.model';

/** loans/{id} — owner-only, schema-checked by the rules (validLoan). */
@Injectable({ providedIn: 'root' })
export class LoanService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'loans');

  readonly loans$: Observable<Loan[]> = this.auth
    .forUser(uid => collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }), [] as any[])
    .pipe(
      map(list => list.map(d => loanFrom(d)).sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.principal - a.principal)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  add(data: Record<string, unknown>) {
    return addDoc(this.col, { ...data, userId: this.auth.requireUid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  update(id: string, data: Record<string, unknown>) {
    return updateDoc(doc(this.firestore, 'loans', id), { ...data, updatedAt: serverTimestamp() });
  }
  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'loans', id));
  }
}
