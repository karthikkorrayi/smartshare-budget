import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of, shareReplay, switchMap } from 'rxjs';
import { BankAccountsService } from './bank-accounts.service';
import { WalletsService } from './wallets.service';
import { CardsService } from './cards.service';
import { CardStatementsService } from './card-statements.service';
import { ExpenseService } from './expense.service';
import { IncomeService } from './income.service';
import { CardTransactionsService } from './card-transactions.service';
import { TransfersService } from './transfers.service';
import { UpcomingPaymentService } from './upcoming-payment.service';
import { ReceivableService } from './receivable.service';
import { AccountRef, AccountSummary, BANK_KIND_LABEL, refKey } from '../models/account.model';
import { WALLET_KIND_INFO } from '../models/wallet.model';
import { cardLabel } from '../models/card.model';
import { dueInfo } from '../models/card-statement.model';
import { RecurringPayment, recurringFrom } from '../models/recurring.model';
import { LendingRecord, lendingFrom } from '../models/lending.model';
import {
  FinanceTxn,
  balanceEffect,
  fromCardTxn,
  fromExpense,
  fromIncome,
  fromTransfer,
  fromWalletTxn,
  monthsIn,
} from '../utils/analytics.util';
import { toDate } from '../utils/firestore.util';
import { daysBetween } from '../utils/date-input.util';

export interface Wealth {
  total: number; // bank + wallet balances (active accounts)
  bank: number;
  wallet: number;
  cardOutstanding: number; // owed on cards — shown separately, not subtracted
  accounts: number;
}

export interface Commitments {
  total: number;
  count: number;
  overdue: number;
  next: { title: string; date: Date; amount: number } | null;
}

/**
 * Read-side of the money model: accounts with live balances, total wealth, and every money record
 * in a date window as one FinanceTxn list. All Firestore reads go through the existing services.
 */
@Injectable({ providedIn: 'root' })
export class FinanceService {
  private banks = inject(BankAccountsService);
  private wallets = inject(WalletsService);
  private cards = inject(CardsService);
  private statements = inject(CardStatementsService);
  private expenses = inject(ExpenseService);
  private income = inject(IncomeService);
  private cardTxns = inject(CardTransactionsService);
  private transfers = inject(TransfersService);
  private upcoming = inject(UpcomingPaymentService);
  private receivables = inject(ReceivableService);

  // ── All-time records that move bank / wallet balances ─────────
  private linked$: Observable<FinanceTxn[]> = combineLatest([
    this.expenses.linkedTo('bank'),
    this.income.linkedTo('bank'),
    this.income.linkedTo('wallet'),
    this.transfers.transfers$,
  ]).pipe(
    map(([be, bi, wi, tr]) => [
      ...be.map(e => fromExpense(e, toDate)),
      ...bi.map(i => fromIncome(i, toDate)),
      ...wi.map(i => fromIncome(i, toDate)),
      ...tr.map(t => fromTransfer(t)),
    ]),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Every account with its live balance; banks first, then wallets, then cards. */
  readonly accounts$: Observable<AccountSummary[]> = combineLatest([
    this.banks.accounts$,
    this.wallets.views$,
    this.wallets.transactions$,
    this.cards.cards$,
    this.statements.statements$,
    this.linked$,
  ]).pipe(
    map(([banks, wallets, wtx, cards, stmts, linked]) => {
      const lastOf = (ref: AccountRef, extra: Date[] = []): Date | null => {
        let last: Date | null = null;
        for (const t of linked) {
          const hit = (t.account?.type === ref.type && t.account.id === ref.id) || (t.account2?.type === ref.type && t.account2.id === ref.id);
          if (hit && (!last || t.date > last)) last = t.date;
        }
        for (const d of extra) if (!last || d > last) last = d;
        return last;
      };
      const eff = (ref: AccountRef) => linked.reduce((s, t) => s + balanceEffect(t, ref), 0);
      const out: AccountSummary[] = [];
      for (const b of banks) {
        const ref: AccountRef = { type: 'bank', id: b.id };
        out.push({
          ref,
          key: refKey(ref),
          name: b.name,
          subtitle: [b.institution || BANK_KIND_LABEL[b.kind], b.lastFour ? `••${b.lastFour}` : ''].filter(Boolean).join(' '),
          type: 'bank',
          balance: round(b.openingBalance + eff(ref)),
          inWealth: b.status === 'Active',
          status: b.status,
          icon: 'landmark',
          art: 'bank',
          lastActivity: lastOf(ref),
        });
      }
      for (const w of wallets) {
        const ref: AccountRef = { type: 'wallet', id: w.id };
        out.push({
          ref,
          key: refKey(ref),
          name: w.name,
          subtitle: w.provider || WALLET_KIND_INFO[w.kind]?.label || 'Wallet',
          type: 'wallet',
          balance: w.balance, // already includes linked income + transfers (WalletsService.views$)
          inWealth: w.status === 'Active',
          status: w.status,
          icon: w.kind === 'cash' ? 'banknote' : w.kind === 'upi' ? 'smartphone' : 'wallet',
          art: w.kind === 'cash' ? 'cash' : 'wallet',
          lastActivity: lastOf(ref, wtx.filter(t => t.walletId === w.id).slice(0, 1).map(t => t.date)),
          low: w.low,
        });
      }
      for (const c of cards) {
        const ref: AccountRef = { type: 'card', id: c.id };
        const owed = stmts.filter(s => s.cardId === c.id && s.status !== 'Paid').reduce((s, x) => s + Math.max(0, x.totalDue - x.paidAmount), 0);
        out.push({
          ref,
          key: refKey(ref),
          name: c.nickname || c.bankName,
          subtitle: `${c.bankName} ••${c.lastFourDigits}`,
          type: 'card',
          balance: round(owed),
          inWealth: false,
          status: c.status,
          icon: 'credit-card',
          art: 'card',
          lastActivity: c.lastUpdated,
        });
      }
      return out;
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly accountMap$: Observable<Map<string, AccountSummary>> = this.accounts$.pipe(
    map(list => new Map(list.map(a => [a.key, a]))),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly wealth$: Observable<Wealth> = this.accounts$.pipe(
    map(list => {
      const active = list.filter(a => a.inWealth);
      const bank = round(active.filter(a => a.type === 'bank').reduce((s, a) => s + a.balance, 0));
      const wallet = round(active.filter(a => a.type === 'wallet').reduce((s, a) => s + a.balance, 0));
      const cardOutstanding = round(list.filter(a => a.type === 'card').reduce((s, a) => s + a.balance, 0));
      return { total: round(bank + wallet), bank, wallet, cardOutstanding, accounts: active.length };
    })
  );

  readonly recurring$: Observable<RecurringPayment[]> = this.upcoming.getAll().pipe(
    map(list => list.map(d => recurringFrom(d)).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly lending$: Observable<LendingRecord[]> = this.receivables.getAll().pipe(
    map(list =>
      list
        .map(d => lendingFrom(d))
        .sort((a, b) => (a.status === b.status ? (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) : a.status === 'PENDING' ? -1 : 1))
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Bills + unpaid card statements due within `days` (overdue included). */
  commitments$(days = 30): Observable<Commitments> {
    return combineLatest([this.recurring$, this.statements.statements$, this.cards.cards$]).pipe(
      map(([rec, stmts, cards]) => {
        const today = new Date();
        const items: { title: string; date: Date; amount: number; overdue: boolean }[] = [];
        for (const p of rec) {
          if (p.paused) continue;
          const d = daysBetween(today, p.dueDate);
          if (d <= days) items.push({ title: p.description, date: p.dueDate, amount: p.amount, overdue: d < 0 });
        }
        const cardMap = new Map(cards.map(c => [c.id, c]));
        for (const s of stmts) {
          if (s.status === 'Paid') continue;
          const info = dueInfo(s, today);
          if (info.days <= days && info.outstanding > 0) {
            const c = cardMap.get(s.cardId);
            items.push({ title: c ? `${cardLabel(c)} bill` : 'Card bill', date: s.dueDate, amount: info.outstanding, overdue: info.days < 0 });
          }
        }
        items.sort((a, b) => a.date.getTime() - b.date.getTime());
        const upcoming = items.filter(i => !i.overdue);
        return {
          total: round(items.reduce((s, i) => s + i.amount, 0)),
          count: items.length,
          overdue: items.filter(i => i.overdue).length,
          next: upcoming[0] ?? items[0] ?? null,
        };
      })
    );
  }

  /**
   * Every money record dated in [start, end) as FinanceTxn, newest first.
   * Expenses / income are read by month key (equality index only); card transactions by date range;
   * wallet transactions and transfers are already in memory.
   */
  window$(start: Date, end: Date): Observable<FinanceTxn[]> {
    const months = monthsIn(start, end);
    return combineLatest([
      this.expenses.getExpensesByMonths(months),
      this.income.getIncomeByMonths(months),
      this.cardTxns.byRange$(start, end),
      this.wallets.transactions$,
      this.transfers.transfers$,
    ]).pipe(
      map(([ex, inc, card, wal, tr]) => {
        const all = [
          ...ex.map(e => fromExpense(e, toDate)),
          ...inc.map(i => fromIncome(i, toDate)),
          ...card.map(c => fromCardTxn(c)),
          ...wal.filter(t => t.date >= start && t.date < end).map(t => fromWalletTxn(t)),
          ...tr.filter(t => t.date >= start && t.date < end).map(t => fromTransfer(t)),
        ];
        return all.filter(t => t.date >= start && t.date < end).sort((a, b) => b.date.getTime() - a.date.getTime());
      })
    );
  }

  /** window$ driven by an observable range (switches listeners when the range changes). */
  windowFor$(range$: Observable<{ start: Date; end: Date } | null>): Observable<FinanceTxn[] | null> {
    return range$.pipe(switchMap(r => (r ? this.window$(r.start, r.end) : of(null))));
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
