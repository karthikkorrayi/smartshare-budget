import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { BankAccount, BankAccountInput, BANK_KINDS } from '../models/account.model';
import { chunk, toDate } from '../utils/firestore.util';

/** bank_accounts/{id} — the user's bank accounts (balance derived, never stored). */
@Injectable({ providedIn: 'root' })
export class BankAccountsService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'bank_accounts');

  readonly accounts$: Observable<BankAccount[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }).pipe(
          map(docs =>
            docs
              .map(d => BankAccountsService.fromFirestore(d))
              .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'Active' ? -1 : 1))
          )
        ),
      [] as BankAccount[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  add(input: BankAccountInput) {
    return addDoc(this.col, {
      ...BankAccountsService.clean(input),
      userId: this.auth.requireUid(),
      currency: 'INR',
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    });
  }

  update(id: string, input: BankAccountInput) {
    return updateDoc(doc(this.firestore, 'bank_accounts', id), { ...BankAccountsService.clean(input), lastUpdated: serverTimestamp() });
  }

  /**
   * Deletes the account. Its expenses / income are KEPT (they still count in your budget) but
   * are unlinked so they no longer point at a missing account; transfers touching it are removed.
   */
  async delete(id: string): Promise<void> {
    const uid = this.auth.requireUid();
    const ops: { kind: 'unlink' | 'delete'; ref: any }[] = [];
    for (const name of ['expenses', 'income']) {
      const snap = await getDocs(query(collection(this.firestore, name), where('userId', '==', uid), where('accountId', '==', id)));
      snap.docs.forEach(d => ops.push({ kind: 'unlink', ref: d.ref }));
    }
    for (const field of ['fromId', 'toId']) {
      const snap = await getDocs(query(collection(this.firestore, 'transfers'), where('userId', '==', uid), where(field, '==', id)));
      snap.docs.forEach(d => ops.push({ kind: 'delete', ref: d.ref }));
    }
    for (const part of chunk(ops)) {
      const b = writeBatch(this.firestore);
      part.forEach(o => (o.kind === 'delete' ? b.delete(o.ref) : b.update(o.ref, { accountType: null, accountId: null })));
      await b.commit();
    }
    const last = writeBatch(this.firestore);
    last.delete(doc(this.firestore, 'bank_accounts', id));
    await last.commit();
  }

  static clean(i: BankAccountInput) {
    return {
      name: i.name.trim().slice(0, 40),
      institution: (i.institution ?? '').trim().slice(0, 60),
      kind: BANK_KINDS.includes(i.kind) ? i.kind : 'other',
      lastFour: /^[0-9]{4}$/.test((i.lastFour ?? '').trim()) ? i.lastFour.trim() : '',
      openingBalance: Math.round((Number(i.openingBalance) || 0) * 100) / 100,
      status: i.status === 'Closed' ? 'Closed' : 'Active',
    };
  }

  static fromFirestore(d: any): BankAccount {
    return {
      id: d.id,
      userId: d.userId,
      name: d.name ?? 'Bank account',
      institution: d.institution ?? '',
      kind: BANK_KINDS.includes(d.kind) ? d.kind : 'other',
      lastFour: d.lastFour ?? '',
      openingBalance: Number(d.openingBalance) || 0,
      currency: 'INR',
      status: d.status === 'Closed' ? 'Closed' : 'Active',
      createdAt: toDate(d.createdAt),
      lastUpdated: toDate(d.lastUpdated),
    };
  }
}
