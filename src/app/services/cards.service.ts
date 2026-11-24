import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
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
import { AUTOPAY_MODES, CARD_ARTS, CARD_DEFAULTS, CARD_NETWORKS, CARD_TIERS, Card, CardInput, REWARD_TYPES } from '../models/card.model';
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
    const num = (v: unknown, max = 1e9) => Math.min(max, Math.max(0, Math.round((Number(v) || 0) * 100) / 100));
    const out: Record<string, unknown> = {
      cardholderName: input.cardholderName.trim(),
      bankName: input.bankName.trim(),
      nickname: (input.nickname ?? '').trim(),
      lastFourDigits: input.lastFourDigits.trim(),
      expiryMonth: Math.trunc(Number(input.expiryMonth)),
      expiryYear: Math.trunc(Number(input.expiryYear)),
      statementDay: Math.trunc(Number(input.statementDay)),
      dueDay: Math.trunc(Number(input.dueDay)),
      status: input.status,
      dailySpendingLimit: num(input.dailySpendingLimit),
      // Phase 2
      network: input.network ?? null,
      tier: input.tier ?? null,
      art: input.art ?? 'indigo',
      creditLimit: num(input.creditLimit),
      cashLimit: num(input.cashLimit),
      openingOutstanding: num(input.openingOutstanding),
      openingAsOf: input.openingAsOf ? Timestamp.fromDate(input.openingAsOf) : null,
      interestMonthly: num(input.interestMonthly, 10),
      annualFee: num(input.annualFee),
      feeWaiverSpend: num(input.feeWaiverSpend),
      lateFee: num(input.lateFee),
      cashAdvanceFeePct: num(input.cashAdvanceFeePct, 10),
      forexMarkupPct: num(input.forexMarkupPct, 10),
      rewardType: input.rewardType ?? 'none',
      rewardRate: num(input.rewardRate, 1000),
      rewardBalance: Math.trunc(num(input.rewardBalance)),
      rewardValue: num(input.rewardValue, 100),
      rewardsAsOf: input.rewardsAsOf ? Timestamp.fromDate(input.rewardsAsOf) : null,
      benefits: [...new Set((input.benefits ?? []).map(b => String(b).trim().slice(0, 40)).filter(Boolean))].slice(0, 20),
      notes: (input.notes ?? '').trim().slice(0, 300),
      autopay: input.autopay ?? 'none',
      utilAlertPct: Math.trunc(num(input.utilAlertPct, 100)),
    };
    return out;
  }

  /** A card's editable fields (for Undo and edit forms). */
  static inputOf(c: Card): CardInput {
    const { id, userId, createdAt, lastUpdated, lastUpdateSource, ...rest } = c;
    return rest;
  }

  private fromFirestore(d: any): Card {
    const n = (v: unknown) => Number(v) || 0;
    const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
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
      dailySpendingLimit: n(d.dailySpendingLimit),
      createdAt: toDate(d.createdAt),
      lastUpdated: toDate(d.lastUpdated),
      lastUpdateSource: d.lastUpdateSource === 'review' ? 'review' : 'manual',
      network: CARD_NETWORKS.includes(d.network) ? d.network : null,
      tier: CARD_TIERS.includes(d.tier) ? d.tier : null,
      art: oneOf(d.art, CARD_ARTS, CARD_DEFAULTS.art),
      creditLimit: n(d.creditLimit),
      cashLimit: n(d.cashLimit),
      openingOutstanding: n(d.openingOutstanding),
      openingAsOf: toDate(d.openingAsOf),
      interestMonthly: n(d.interestMonthly),
      annualFee: n(d.annualFee),
      feeWaiverSpend: n(d.feeWaiverSpend),
      lateFee: n(d.lateFee),
      cashAdvanceFeePct: n(d.cashAdvanceFeePct),
      forexMarkupPct: n(d.forexMarkupPct),
      rewardType: oneOf(d.rewardType, REWARD_TYPES, 'none'),
      rewardRate: n(d.rewardRate),
      rewardBalance: n(d.rewardBalance),
      rewardValue: n(d.rewardValue),
      rewardsAsOf: toDate(d.rewardsAsOf),
      benefits: Array.isArray(d.benefits) ? d.benefits.filter((x: unknown) => typeof x === 'string') : [],
      notes: d.notes ?? '',
      autopay: oneOf(d.autopay, AUTOPAY_MODES, 'none'),
      utilAlertPct: n(d.utilAlertPct),
    };
  }
}
