import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { SpendingService } from './spending.service';
import {
  Wallet,
  WalletInput,
  WalletTransaction,
  WalletTxnInput,
  WalletTxnType,
  isLowBalance,
  walletBalance,
} from '../models/wallet.model';
import { chunk, toDate } from '../utils/firestore.util';
import { monthRange } from '../utils/date-input.util';

export interface WalletView extends Wallet {
  balance: number;
  low: boolean;
}

/**
 * Wallets and their transactions. Both are read with an equality filter on userId only, so no
 * composite index is needed; month views and balances are worked out here.
 */
@Injectable({ providedIn: 'root' })
export class WalletsService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private spending = inject(SpendingService);
  private wallets = collection(this.firestore, 'wallets');
  private txns = collection(this.firestore, 'wallet_transactions');

  readonly wallets$: Observable<Wallet[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.wallets, where('userId', '==', uid)), { idField: 'id' }).pipe(
          map(docs =>
            docs
              .map(d => WalletsService.walletFrom(d))
              .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'Active' ? -1 : 1))
          )
        ),
      [] as Wallet[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Every wallet transaction, newest first. */
  readonly transactions$: Observable<WalletTransaction[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.txns, where('userId', '==', uid)), { idField: 'id' }).pipe(
          map(docs => docs.map(d => WalletsService.txnFrom(d)).sort((a, b) => b.date.getTime() - a.date.getTime()))
        ),
      [] as WalletTransaction[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Wallets with their live balance. */
  readonly views$: Observable<WalletView[]> = combineLatest([this.wallets$, this.transactions$]).pipe(
    map(([wallets, txns]) =>
      wallets.map(w => {
        const balance = walletBalance(w, txns);
        return { ...w, balance, low: isLowBalance(w, balance) };
      })
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  byMonth$(month: string): Observable<WalletTransaction[]> {
    const [start, end] = monthRange(month);
    return this.transactions$.pipe(map(list => list.filter(t => t.date >= start && t.date < end)));
  }

  // ── Wallets ───────────────────────────────────────────────────
  addWallet(input: WalletInput) {
    return addDoc(this.wallets, {
      ...WalletsService.cleanWallet(input),
      userId: this.auth.requireUid(),
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    });
  }

  updateWallet(id: string, input: WalletInput) {
    return updateDoc(doc(this.firestore, 'wallets', id), { ...WalletsService.cleanWallet(input), lastUpdated: serverTimestamp() });
  }

  /** Wallet and all of its transactions. */
  async deleteWithHistory(id: string): Promise<void> {
    const uid = this.auth.requireUid();
    const snap = await getDocs(query(this.txns, where('userId', '==', uid), where('walletId', '==', id)));
    for (const part of chunk(snap.docs)) {
      const b = writeBatch(this.firestore);
      part.forEach(d => b.delete(d.ref));
      await b.commit();
    }
    await deleteDoc(doc(this.firestore, 'wallets', id));
  }

  // ── Transactions ──────────────────────────────────────────────
  async addTxn(input: WalletTxnInput) {
    const ref = await addDoc(this.txns, {
      ...WalletsService.cleanTxn(input),
      userId: this.auth.requireUid(),
      source: 'manual',
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    });
    if (input.type === 'spend') void this.spending.afterSpend({ date: input.date, amount: input.amount });
    return ref;
  }

  updateTxn(id: string, input: WalletTxnInput) {
    return updateDoc(doc(this.firestore, 'wallet_transactions', id), { ...WalletsService.cleanTxn(input), lastUpdated: serverTimestamp() });
  }

  deleteTxn(id: string) {
    return deleteDoc(doc(this.firestore, 'wallet_transactions', id));
  }

  // ── Mapping ───────────────────────────────────────────────────
  static cleanWallet(i: WalletInput) {
    const out: Record<string, unknown> = {
      name: i.name.trim().slice(0, 40),
      kind: i.kind,
      openingBalance: Math.round((Number(i.openingBalance) || 0) * 100) / 100,
      lowBalanceAlert: Math.max(0, Math.round((Number(i.lowBalanceAlert) || 0) * 100) / 100),
      status: i.status === 'Closed' ? 'Closed' : 'Active',
    };
    out['provider'] = (i.provider ?? '').trim().slice(0, 40);
    return out;
  }

  static cleanTxn(i: WalletTxnInput) {
    return {
      walletId: i.walletId,
      type: i.type,
      amount: Math.round(Number(i.amount) * 100) / 100,
      date: Timestamp.fromDate(i.date),
      description: i.description.trim().slice(0, 120),
      category: i.type === 'spend' || i.type === 'refund' ? (i.category ?? '').trim().slice(0, 30) : '',
    };
  }

  static walletFrom(d: any): Wallet {
    return {
      id: d.id,
      userId: d.userId,
      name: d.name ?? 'Wallet',
      kind: ['cash', 'upi', 'prepaid', 'other'].includes(d.kind) ? d.kind : 'other',
      provider: d.provider ?? '',
      openingBalance: Number(d.openingBalance) || 0,
      lowBalanceAlert: Number(d.lowBalanceAlert) || 0,
      status: d.status === 'Closed' ? 'Closed' : 'Active',
      createdAt: toDate(d.createdAt),
      lastUpdated: toDate(d.lastUpdated),
    };
  }

  static txnFrom(d: any): WalletTransaction {
    const type: WalletTxnType = ['spend', 'topup', 'refund', 'cashback'].includes(d.type) ? d.type : 'spend';
    return {
      id: d.id,
      userId: d.userId,
      walletId: d.walletId,
      type,
      amount: Number(d.amount) || 0,
      date: toDate(d.date) ?? new Date(),
      description: d.description ?? '',
      category: d.category ?? '',
      source: d.source === 'email' ? 'email' : d.source === 'demo' ? 'demo' : 'manual',
      reviewId: d.reviewId ?? null,
      createdAt: toDate(d.createdAt),
      lastUpdated: toDate(d.lastUpdated),
    };
  }
}
