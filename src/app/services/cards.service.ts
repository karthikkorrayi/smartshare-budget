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
import { Card, CardInput } from '../models/card.model';
import { chunk, toDate } from '../utils/firestore.util';

@Injectable({ providedIn: 'root' })
export class CardsService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'cards');

  /** All the user's cards (active first, then by bank). Shared by every page + the notification badge. */
  readonly cards$: Observable<Card[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }).pipe(
          map(docs =>
            docs
              .map(d => this.fromFirestore(d))
              .sort(
                (a, b) =>
                  (a.status === b.status ? 0 : a.status === 'Active' ? -1 : 1) ||
                  a.bankName.localeCompare(b.bankName) ||
                  a.lastFourDigits.localeCompare(b.lastFourDigits)
              )
          )
        ),
      [] as Card[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  add(input: CardInput) {
    return addDoc(this.col, {
      ...this.clean(input),
      monitoredConnectionIds: [],
      userId: this.auth.requireUid(),
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
      lastUpdateSource: 'manual',
    });
  }

  update(id: string, input: CardInput) {
    return updateDoc(doc(this.firestore, 'cards', id), {
      ...this.clean(input),
      lastUpdated: serverTimestamp(),
      lastUpdateSource: 'manual',
    });
  }

  /** Deletes the card and every transaction / statement that belongs to it. */
  async deleteWithHistory(cardId: string): Promise<number> {
    const uid = this.auth.requireUid();
    const refs = [];
    for (const name of ['card_transactions', 'card_statements']) {
      const snap = await getDocs(
        query(collection(this.firestore, name), where('userId', '==', uid), where('cardId', '==', cardId))
      );
      refs.push(...snap.docs.map(d => d.ref));
    }
    // Children first; the card document goes in the last batch so a partial failure never orphans history.
    const batches = chunk(refs);
    for (const part of batches) {
      const b = writeBatch(this.firestore);
      part.forEach(r => b.delete(r));
      await b.commit();
    }
    const last = writeBatch(this.firestore);
    last.delete(doc(this.firestore, 'cards', cardId));
    await last.commit();
    return refs.length;
  }

  /** Normalises input to exactly the fields the security rules allow. */
  private clean(input: CardInput) {
    return {
      cardholderName: input.cardholderName.trim(),
      bankName: input.bankName.trim(),
      nickname: (input.nickname ?? '').trim(),
      lastFourDigits: input.lastFourDigits.trim(),
      expiryMonth: Math.trunc(Number(input.expiryMonth)),
      expiryYear: Math.trunc(Number(input.expiryYear)),
      statementDay: Math.trunc(Number(input.statementDay)),
      dueDay: Math.trunc(Number(input.dueDay)),
      status: input.status,
      autoMonitor: !!input.autoMonitor,
      dailySpendingLimit: Math.max(0, Number(input.dailySpendingLimit) || 0),
    };
  }

  private fromFirestore(d: any): Card {
    return {
      id: d.id,
      userId: d.userId,
      cardholderName: d.cardholderName ?? '',
      bankName: d.bankName ?? '',
      nickname: d.nickname ?? '',
      lastFourDigits: d.lastFourDigits ?? '----',
      expiryMonth: Number(d.expiryMonth) || 1,
      expiryYear: Number(d.expiryYear) || 2000,
      statementDay: Number(d.statementDay) || 1,
      dueDay: Number(d.dueDay) || 1,
      status: d.status === 'Closed' ? 'Closed' : 'Active',
      autoMonitor: !!d.autoMonitor,
      monitoredConnectionIds: Array.isArray(d.monitoredConnectionIds) ? d.monitoredConnectionIds : [],
      dailySpendingLimit: Number(d.dailySpendingLimit) || 0,
      createdAt: toDate(d.createdAt),
      lastUpdated: toDate(d.lastUpdated),
      lastUpdateSource: d.lastUpdateSource === 'review' ? 'review' : 'manual',
    };
  }
}
