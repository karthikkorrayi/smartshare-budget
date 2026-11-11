import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
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
      return combineLatest([expenses$, cards$]).pipe(map(([a, b]) => [...a, ...b]));
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
          null
        );
      }
      if (spend.cardId && cardLimit > 0) {
        const onCard = spentOn(entries, day, spend.cardId);
        if (crossedLimit(onCard, amount, cardLimit)) {
          await this.warn(
            `Card limit crossed · ${cardName}`,
            `₹${fmt(onCard)} on this card today — over its ₹${fmt(cardLimit)} daily limit.`,
            spend.cardId
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
    const [e, c] = await Promise.all([
      getDocs(query(collection(this.firestore, 'expenses'), where('userId', '==', uid), where('date', '>=', start), where('date', '<', end))),
      getDocs(query(collection(this.firestore, 'card_transactions'), where('userId', '==', uid), where('txnDate', '>=', start), where('txnDate', '<', end))),
    ]);
    return [
      ...e.docs.map(d => this.expenseEntry(d.data())).filter((x): x is SpendEntry => !!x),
      ...c.docs.filter(d => d.get('direction') !== 'credit').map(d => this.cardEntry(d.data())).filter((x): x is SpendEntry => !!x),
    ];
  }

  private async warn(title: string, body: string, cardId: string | null): Promise<void> {
    this.alerts.show({ tone: 'warn', title, body, link: '/notifications' }, 10000);
    await addDoc(collection(this.firestore, 'notifications'), {
      userId: this.auth.requireUid(),
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
    const date = toDate(d?.date);
    const amount = Number(d?.amount) || 0;
    return date && amount > 0 ? { date, amount, source: 'expense' } : null;
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
