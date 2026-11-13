import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';
import { AlertsService } from './alerts.service';
import { SpendEntry, addDays, crossedLimit, spentOn } from '../utils/spending.util';
import { toDate } from '../utils/firestore.util';

export const PULSE_DAYS = 60;

/**
 * "Spend" = every expense + every card DEBIT (refunds and bill payments don't count).
 * Note: if you record a card's bill payment as an Expense too, that money is counted twice.
 */
@Injectable({ providedIn: 'root' })
export class SpendingService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private settings = inject(SettingsService);
  private alerts = inject(AlertsService);

  /** Live spend for the last 60 days. Needs indexes expenses(userId, date) and card_transactions(userId, txnDate). */
  readonly recent$: Observable<SpendEntry[]> = this.auth
    .forUser(uid => {
      const since = Timestamp.fromDate(addDays(new Date(), -PULSE_DAYS));
      const expenses$ = collectionData(
        query(collection(this.firestore, 'expenses'), where('userId', '==', uid), where('date', '>=', since))
      ).pipe(map(docs => docs.map(d => this.expenseEntry(d)).filter((e): e is SpendEntry => !!e)));
      const cards$ = collectionData(
        query(collection(this.firestore, 'card_transactions'), where('userId', '==', uid), where('txnDate', '>=', since))
      ).pipe(map(docs => docs.filter(d => d['direction'] !== 'credit').map(d => this.cardEntry(d)).filter((e): e is SpendEntry => !!e)));
      // Wallet spends (userId filter only — no extra index; filtered by date here).
      const sinceDate = since.toDate();
      const wallets$ = collectionData(query(collection(this.firestore, 'wallet_transactions'), where('userId', '==', uid))).pipe(
        map(docs => docs.map(d => this.walletEntry(d)).filter((e): e is SpendEntry => !!e && e.date >= sinceDate))
      );
      return combineLatest([expenses$, cards$, wallets$]).pipe(map(([a, b, c]) => [...a, ...b, ...c]));
    }, [] as SpendEntry[])
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /**
   * Call AFTER a spend is saved. Warns once per crossing of the overall daily limit and of the card's
   * own limit: an in-app toast plus an entry in Notifications. Never throws (the save already succeeded).
   */
  async afterSpend(spend: { date: Date; amount: number; cardId?: string }): Promise<void> {
    try {
      const amount = Number(spend.amount) || 0;
      if (amount <= 0) return;
      const day = spend.date ?? new Date();
      const s = await this.settings.current();

      let cardLimit = 0;
      let cardName = '';
      if (spend.cardId) {
        const c = await getDoc(doc(this.firestore, 'cards', spend.cardId));
        cardLimit = Number(c.get('dailySpendingLimit')) || 0;
        cardName = `${c.get('nickname') || c.get('bankName')} ••${c.get('lastFourDigits')}`;
      }
      if (!(s.dailyLimit > 0) && !(cardLimit > 0)) return;

      const entries = await this.dayEntries(day);
      const overall = spentOn(entries, day);
      if (crossedLimit(overall, amount, s.dailyLimit)) {
        await this.warn(
          `Daily limit crossed`,
          `You've spent ₹${fmt(overall)} today — ₹${fmt(overall - s.dailyLimit)} over your ₹${fmt(s.dailyLimit)} limit.`,
          null,
          day
        );
      }
      if (spend.cardId && cardLimit > 0) {
        const onCard = spentOn(entries, day, spend.cardId);
        if (crossedLimit(onCard, amount, cardLimit)) {
          await this.warn(
            `Card limit crossed · ${cardName}`,
            `₹${fmt(onCard)} on this card today — over its ₹${fmt(cardLimit)} daily limit.`,
            spend.cardId,
            day
          );
        }
      }
    } catch (err) {
      console.warn('[Spending] limit check failed', err);
    }
  }

  private async dayEntries(day: Date): Promise<SpendEntry[]> {
    const uid = this.auth.requireUid();
    const start = Timestamp.fromDate(new Date(day.getFullYear(), day.getMonth(), day.getDate()));
    const end = Timestamp.fromDate(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1));
    const [e, c, w] = await Promise.all([
      getDocs(query(collection(this.firestore, 'expenses'), where('userId', '==', uid), where('date', '>=', start), where('date', '<', end))),
      getDocs(query(collection(this.firestore, 'card_transactions'), where('userId', '==', uid), where('txnDate', '>=', start), where('txnDate', '<', end))),
      getDocs(query(collection(this.firestore, 'wallet_transactions'), where('userId', '==', uid))),
    ]);
    const [from, to] = [start.toDate(), end.toDate()];
    return [
      ...e.docs.map(d => this.expenseEntry(d.data())).filter((x): x is SpendEntry => !!x),
      ...c.docs.filter(d => d.get('direction') !== 'credit').map(d => this.cardEntry(d.data())).filter((x): x is SpendEntry => !!x),
      ...w.docs.map(d => this.walletEntry(d.data())).filter((x): x is SpendEntry => !!x && x.date >= from && x.date < to),
    ];
  }

  private async warn(title: string, body: string, cardId: string | null, day: Date): Promise<void> {
    // One warning per limit per day: deleting/undoing and re-adding a spend doesn't repeat it.
    const uid = this.auth.requireUid();
    const ymd = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
    const ref = doc(this.firestore, 'notifications', `limit-${uid}-${ymd}-${cardId ?? 'all'}`);
    if ((await getDoc(ref).catch(() => null))?.exists()) return;
    this.alerts.show({ tone: 'warn', title, body, link: '/notifications' }, 10000);
    await setDoc(ref, {
      userId: uid,
      type: 'limit_exceeded',
      title,
      body,
      cardId,
      link: cardId ? '/cards/transactions' : '/',
      read: false,
      origin: 'client',
      createdAt: serverTimestamp(),
    });
  }

  private expenseEntry(d: any): SpendEntry | null {
    // Same rule as Overview: card bill payments and repaid loans aren't spending.
    if (d?.category === 'Card Bill' || d?.category === 'Wallet Top-up' || d?.status === 'PAID') return null;
    const date = toDate(d?.date);
    const amount = Number(d?.amount) || 0;
    return date && amount > 0 ? { date, amount, source: 'expense' } : null;
  }

  /** Wallet spends only (top-ups, refunds and cashback aren't spending). */
  private walletEntry(d: any): SpendEntry | null {
    if (d?.type !== 'spend') return null;
    const date = toDate(d?.date);
    const amount = Number(d?.amount) || 0;
    return date && amount > 0 ? { date, amount, source: 'wallet' } : null;
  }

  private cardEntry(d: any): SpendEntry | null {
    const date = toDate(d?.txnDate);
    const amount = Number(d?.amount) || 0;
    return date && amount > 0 ? { date, amount, source: 'card', cardId: d?.cardId } : null;
  }
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}
