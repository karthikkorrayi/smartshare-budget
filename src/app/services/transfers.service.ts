import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { Transfer, TransferInput } from '../models/account.model';
import { toDate } from '../utils/firestore.util';

/** transfers/{id} — money moved between your own bank accounts and wallets (not income, not spending). */
@Injectable({ providedIn: 'root' })
export class TransfersService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'transfers');

  readonly transfers$: Observable<Transfer[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }).pipe(
          map(docs => docs.map(d => TransfersService.fromFirestore(d)).sort((a, b) => b.date.getTime() - a.date.getTime()))
        ),
      [] as Transfer[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  add(input: TransferInput) {
    return addDoc(this.col, { ...TransfersService.clean(input), userId: this.auth.requireUid(), createdAt: serverTimestamp() });
  }

  update(id: string, input: TransferInput) {
    return updateDoc(doc(this.firestore, 'transfers', id), TransfersService.clean(input));
  }

  delete(id: string) {
    return deleteDoc(doc(this.firestore, 'transfers', id));
  }

  static clean(i: TransferInput) {
    return {
      fromType: i.fromType,
      fromId: i.fromId,
      toType: i.toType,
      toId: i.toId,
      amount: Math.round(Number(i.amount) * 100) / 100,
      date: Timestamp.fromDate(i.date),
      note: (i.note ?? '').trim().slice(0, 120),
    };
  }

  static fromFirestore(d: any): Transfer {
    return {
      id: d.id,
      userId: d.userId,
      fromType: d.fromType === 'wallet' ? 'wallet' : 'bank',
      fromId: d.fromId,
      toType: d.toType === 'wallet' ? 'wallet' : 'bank',
      toId: d.toId,
      amount: Number(d.amount) || 0,
      date: toDate(d.date) ?? new Date(),
      note: d.note ?? '',
      createdAt: toDate(d.createdAt),
    };
  }
}
