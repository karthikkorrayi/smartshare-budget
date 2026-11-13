import { Injectable, inject } from '@angular/core';
import { ExpenseService } from './expense.service';
import { IncomeService } from './income.service';
import { CardTransactionsService } from './card-transactions.service';
import { WalletsService } from './wallets.service';
import { TransfersService } from './transfers.service';
import { UpcomingPaymentService } from './upcoming-payment.service';
import { ReceivableService } from './receivable.service';
import { StateManagementService } from './state-management.service';
import { AccountRef } from '../models/account.model';
import { TXN_CATEGORIES } from '../models/card-transaction.model';
import { WALLET_CATEGORIES } from '../models/wallet.model';
import { RecurringPayment, nextOccurrence } from '../models/recurring.model';
import { LendDirection, LendingRecord } from '../models/lending.model';
import { FinanceTxn } from '../utils/analytics.util';
import { monthKey } from '../utils/date-input.util';

export interface ExpenseFields {
  description: string;
  amount: number;
  category: string;
  date: Date;
  notes?: string;
  recurringId?: string;
}
export interface IncomeFields {
  source: string;
  amount: number;
  category: string;
  date: Date;
  notes?: string;
}
export interface Saved {
  key: string;
  undo: () => Promise<unknown>;
}

const round = (n: number) => Math.round(Number(n) * 100) / 100;

/**
 * Write-side of the account-centric model. Every entry is stored through the EXISTING service for
 * its account type, so the budget maths, security rules, spending-limit checks and email-review
 * links stay exactly as they were:
 *   bank account → expenses / income (with accountType + accountId)
 *   credit card  → card_transactions (debit)
 *   wallet       → wallet_transactions (spend) / income (with accountType 'wallet')
 */
@Injectable({ providedIn: 'root' })
export class LedgerService {
  private expenses = inject(ExpenseService);
  private income = inject(IncomeService);
  private cardTxns = inject(CardTransactionsService);
  private wallets = inject(WalletsService);
  private transfers = inject(TransfersService);
  private upcoming = inject(UpcomingPaymentService);
  private receivables = inject(ReceivableService);
  private state = inject(StateManagementService);

  // ── Expenses ──────────────────────────────────────────────────
  async recordExpense(ref: AccountRef | null, f: ExpenseFields): Promise<Saved> {
    const amount = round(f.amount);
    const description = f.description.trim().slice(0, 120);
    if (ref?.type === 'card') {
      const r = await this.cardTxns.add({
        cardId: ref.id,
        txnDate: f.date,
        amount,
        direction: 'debit',
        description,
        category: pick(TXN_CATEGORIES, f.category),
      });
      return { key: `card:${r.id}`, undo: () => this.cardTxns.delete(r.id) };
    }
    if (ref?.type === 'wallet') {
      const r = await this.wallets.addTxn({ walletId: ref.id, type: 'spend', amount, date: f.date, description, category: pick(WALLET_CATEGORIES, f.category) });
      return { key: `wallet:${r.id}`, undo: () => this.wallets.deleteTxn(r.id) };
    }
    const r = await this.expenses.addExpense({
      description,
      amount,
      category: f.category || 'Others',
      date: f.date,
      month: monthKey(f.date),
      ...(ref ? { accountType: 'bank', accountId: ref.id } : {}),
      ...(f.notes?.trim() ? { notes: f.notes.trim().slice(0, 300) } : {}),
      ...(f.recurringId ? { recurringId: f.recurringId } : {}),
    });
    return { key: `expense:${r.id}`, undo: () => this.expenses.deleteExpense(r.id) };
  }

  // ── Income ────────────────────────────────────────────────────
  async recordIncome(ref: AccountRef | null, f: IncomeFields): Promise<Saved> {
    const r = await this.income.addIncome({
      source: f.source.trim().slice(0, 120),
      amount: round(f.amount),
      category: f.category || 'Other income',
      date: f.date,
      month: monthKey(f.date),
      ...(ref && ref.type !== 'card' ? { accountType: ref.type, accountId: ref.id } : {}),
      ...(f.notes?.trim() ? { notes: f.notes.trim().slice(0, 300) } : {}),
    });
    return { key: `income:${r.id}`, undo: () => this.income.deleteIncome(r.id) };
  }

  // ── Transfers ─────────────────────────────────────────────────
  async recordTransfer(from: AccountRef, to: AccountRef, amount: number, date: Date, note: string): Promise<Saved> {
    if (from.type === 'card' || to.type === 'card') throw new Error('Transfers are between bank accounts and wallets.');
    if (from.type === to.type && from.id === to.id) throw new Error('Pick two different accounts.');
    const r = await this.transfers.add({ fromType: from.type, fromId: from.id, toType: to.type, toId: to.id, amount: round(amount), date, note });
    return { key: `transfer:${r.id}`, undo: () => this.transfers.delete(r.id) };
  }

  // ── Edit / delete any FinanceTxn ──────────────────────────────
  /**
   * Updates an entry. If the account TYPE changes (e.g. a bank expense moved to a card), the
   * entry is re-created in the right collection and the old one removed.
   */
  async updateExpense(t: FinanceTxn, ref: AccountRef | null, f: ExpenseFields): Promise<Saved> {
    const storedAs = t.kind;
    const target = ref?.type === 'card' ? 'card' : ref?.type === 'wallet' ? 'wallet' : 'expense';
    if (storedAs === target) {
      if (storedAs === 'card') {
        const before = t.raw;
        await this.cardTxns.update(before, { cardId: ref!.id, txnDate: f.date, amount: round(f.amount), direction: before.direction, description: f.description.trim(), category: pick(TXN_CATEGORIES, f.category) });
        return { key: t.key, undo: () => this.cardTxns.restore(before) };
      }
      if (storedAs === 'wallet') {
        const b = t.raw;
        await this.wallets.updateTxn(t.id, { walletId: ref!.id, type: b.type, amount: round(f.amount), date: f.date, description: f.description.trim(), category: pick(WALLET_CATEGORIES, f.category) });
        return { key: t.key, undo: () => this.wallets.updateTxn(t.id, { walletId: b.walletId, type: b.type, amount: b.amount, date: b.date, description: b.description, category: b.category }) };
      }
      const b = t.raw;
      await this.expenses.updateExpense({
        id: t.id,
        description: f.description.trim(),
        amount: round(f.amount),
        category: f.category,
        date: f.date,
        month: monthKey(f.date),
        accountType: ref ? 'bank' : null,
        accountId: ref ? ref.id : null,
        notes: (f.notes ?? '').trim().slice(0, 300),
      });
      return {
        key: t.key,
        undo: () =>
          this.expenses.updateExpense({
            id: b.id, description: b.description, amount: b.amount, category: b.category, date: t.date, month: b.month,
            accountType: b.accountType ?? null, accountId: b.accountId ?? null, notes: b.notes ?? '',
          }),
      };
    }
    // Moving between collections.
    const created = await this.recordExpense(ref, f);
    await this.delete(t);
    return { key: created.key, undo: created.undo };
  }

  async updateIncome(t: FinanceTxn, ref: AccountRef | null, f: IncomeFields): Promise<Saved> {
    if (t.system) throw new Error('System-generated entries can’t be edited.');
    const b = t.raw;
    await this.income.updateIncome({
      id: t.id,
      source: f.source.trim(),
      amount: round(f.amount),
      category: f.category,
      date: f.date,
      month: monthKey(f.date),
      accountType: ref && ref.type !== 'card' ? ref.type : null,
      accountId: ref && ref.type !== 'card' ? ref.id : null,
      notes: (f.notes ?? '').trim().slice(0, 300),
    });
    return {
      key: t.key,
      undo: () =>
        this.income.updateIncome({
          id: b.id, source: b.source, amount: b.amount, category: b.category ?? null, date: t.date, month: b.month,
          accountType: b.accountType ?? null, accountId: b.accountId ?? null, notes: b.notes ?? '',
        }),
    };
  }

  async updateTransfer(t: FinanceTxn, from: AccountRef, to: AccountRef, amount: number, date: Date, note: string): Promise<Saved> {
    const b = t.raw;
    await this.transfers.update(t.id, { fromType: from.type as any, fromId: from.id, toType: to.type as any, toId: to.id, amount, date, note });
    return { key: t.key, undo: () => this.transfers.update(t.id, b) };
  }

  /** Deletes one entry (system-generated entries are protected). */
  delete(t: FinanceTxn): Promise<unknown> {
    if (t.system) return Promise.reject(new Error('System-generated entries can’t be deleted.'));
    switch (t.kind) {
      case 'expense': return this.expenses.deleteExpense(t.id);
      case 'income': return this.income.deleteIncome(t.id);
      case 'card': return this.cardTxns.delete(t.id);
      case 'wallet': return this.wallets.deleteTxn(t.id);
      case 'transfer': return this.transfers.delete(t.id);
    }
  }

  // ── Recurring payments ────────────────────────────────────────
  async saveRecurring(id: string | null, data: Record<string, unknown>): Promise<string> {
    const due = data['dueDate'] as Date;
    const doc = { ...data, month: monthKey(due) };
    if (id) {
      await this.upcoming.update(id, doc);
      return id;
    }
    const r = await this.upcoming.add({ ...doc, createdAt: new Date() });
    return r.id;
  }

  /**
   * Pays the current cycle: books the expense against the payment's account, then either removes
   * a one-time payment (same as before) or moves a recurring one to its next due date.
   */
  async payRecurring(p: RecurringPayment, amount = p.amount, date = new Date()): Promise<void> {
    const saved = await this.recordExpense(p.account, {
      description: p.description,
      amount,
      category: p.category || 'Bills',
      date,
      recurringId: p.id,
    });
    if (p.frequency === 'once') {
      await this.upcoming.delete(p.id);
      return;
    }
    await this.advance(p, { date, amount: round(amount), ref: saved.key });
  }

  /** Recurring only: move to the next due date without booking anything. */
  skipRecurring(p: RecurringPayment): Promise<void> {
    return this.advance(p, { date: new Date(), amount: 0, ref: null, skipped: true });
  }

  setPaused(p: RecurringPayment, paused: boolean) {
    return this.upcoming.update(p.id, { paused });
  }

  private async advance(p: RecurringPayment, entry: { date: Date; amount: number; ref: string | null; skipped?: boolean }) {
    const anchor = (p.raw?.anchorDay as number) || p.dueDate.getDate();
    const next = nextOccurrence(p.dueDate, p.frequency, p.intervalDays, anchor);
    const history = [entry, ...p.history].slice(0, 24).map(h => ({ date: h.date, amount: h.amount, ref: h.ref, ...(h.skipped ? { skipped: true } : {}) }));
    await this.upcoming.update(p.id, {
      dueDate: next,
      month: monthKey(next),
      anchorDay: anchor,
      history,
      ...(entry.skipped ? {} : { lastPaidAt: entry.date }),
    });
  }

  // ── Lending / borrowing ───────────────────────────────────────
  async addLending(x: {
    direction: LendDirection;
    person: string;
    amount: number;
    date: Date;
    dueDate: Date | null;
    track: boolean;
    account: AccountRef | null;
    notes: string;
  }): Promise<Saved> {
    const amount = round(x.amount);
    const person = x.person.trim().slice(0, 60);
    let lentExpenseId: string | null = null;
    if (x.direction === 'lent' && x.track) {
      const e = await this.recordExpense(x.account?.type === 'bank' ? x.account : null, {
        description: `Lent: ${person}`,
        amount,
        category: 'Lent',
        date: x.date,
      });
      lentExpenseId = e.key.split(':')[1];
    }
    const r = await this.receivables.add({
      title: person,
      amount,
      createdAt: x.date,
      date: x.date,
      status: 'PENDING',
      direction: x.direction,
      trackInExpenses: x.direction === 'lent' && !!x.track,
      settledAmount: 0,
      ...(x.dueDate ? { dueDate: x.dueDate } : {}),
      ...(x.notes.trim() ? { notes: x.notes.trim().slice(0, 300) } : {}),
      ...(x.account?.type === 'bank' ? { accountType: 'bank', accountId: x.account.id } : {}),
      ...(lentExpenseId ? { lentExpenseId } : {}),
    });
    return {
      key: `receivable:${r.id}`,
      undo: () => this.state.removeReceivableCompletely({ receivableId: r.id, lentExpenseId }),
    };
  }

  /**
   * Records a (partial) repayment. For tracked money you lent, the repayment is income on the day
   * it's received — the same rule the dashboard always used.
   */
  async settleLending(r: LendingRecord, amount: number, account: AccountRef | null, date = new Date()): Promise<void> {
    const pay = Math.min(round(amount), r.outstanding);
    if (!(pay > 0)) return;
    if (r.direction === 'lent' && r.trackInExpenses) {
      await this.income.addIncome({
        source: `Received from ${r.person}`,
        amount: pay,
        date,
        month: monthKey(date),
        isSystemGenerated: true,
        category: 'Repayment',
        ...(account && account.type !== 'card' ? { accountType: account.type, accountId: account.id } : {}),
      });
    }
    const settled = round(r.settled + pay);
    const done = settled >= r.amount - 0.005;
    await this.receivables.update(r.id, {
      settledAmount: settled,
      history: [...r.history, { date, amount: pay }].slice(-24),
      ...(done ? { status: 'PAID', paidDate: date, paidInMonth: monthKey(date) } : {}),
    });
  }

  /** Pending: also removes its "Lent" expense (existing rule). Settled: only the ledger entry goes. */
  deleteLending(r: LendingRecord) {
    return r.status === 'PAID' ? this.receivables.delete(r.id) : this.state.deleteReceivable(r.id, [r.raw], []);
  }
}

function pick(list: readonly string[], v: string): string {
  if (list.includes(v)) return v;
  const alias: Record<string, string> = { Transport: 'Travel', Petrol: 'Fuel', Tickets: 'Entertainment', 'Card Bill': 'Card Payment' };
  return list.includes(alias[v]) ? alias[v] : list.includes('Others') ? 'Others' : list[0];
}
