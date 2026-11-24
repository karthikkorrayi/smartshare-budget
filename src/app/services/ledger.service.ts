import { Injectable, inject } from '@angular/core';
import { ExpenseService } from './expense.service';
import { IncomeService } from './income.service';
import { CardTransactionsService } from './card-transactions.service';
import { WalletsService } from './wallets.service';
import { TransfersService } from './transfers.service';
import { UpcomingPaymentService } from './upcoming-payment.service';
import { ReceivableService } from './receivable.service';
import { AccountRef } from '../models/account.model';
import { TXN_CATEGORIES } from '../models/card-transaction.model';
import { WALLET_CATEGORIES } from '../models/wallet.model';
import { RecurringPayment, nextOccurrence } from '../models/recurring.model';
import { LendDirection, LendingRecord, normalizePhone } from '../models/lending.model';
import { toDate } from '../utils/firestore.util';
import { Firestore, deleteField, doc, getDoc } from '@angular/fire/firestore';
import { FinanceTxn } from '../utils/analytics.util';
import { monthKey, startOfDay } from '../utils/date-input.util';

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
  private firestore = inject(Firestore);

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
   * Pays the current cycle: books the expense against the chosen account (default: the payment's own),
   * then either removes a one-time payment (same as before) or moves a recurring one to its next due
   * date. Fixed-term plans count the installment and are marked completed after the last one.
   */
  async payRecurring(p: RecurringPayment, amount = p.amount, date = new Date(), account: AccountRef | null = p.account): Promise<void> {
    const saved = await this.recordExpense(account, {
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

  /** Recurring only: move to the next due date without booking anything (an installment isn't counted). */
  skipRecurring(p: RecurringPayment): Promise<void> {
    return this.advance(p, { date: new Date(), amount: 0, ref: null, skipped: true });
  }

  setPaused(p: RecurringPayment, paused: boolean) {
    return this.upcoming.update(p.id, { paused });
  }

  private async advance(p: RecurringPayment, entry: { date: Date; amount: number; ref: string | null; skipped?: boolean }) {
    const anchor = p.anchorDay;
    const next = nextOccurrence(p.dueDate, p.frequency, p.intervalDays, anchor);
    const history = [entry, ...p.history].slice(0, 24).map(h => ({ date: h.date, amount: h.amount, ref: h.ref, ...(h.skipped ? { skipped: true } : {}) }));
    const paid = p.installmentsPaid + (entry.skipped ? 0 : 1);
    const done =
      (p.endType === 'count' && p.installmentsTotal > 0 && paid >= p.installmentsTotal) ||
      (p.endType === 'date' && !!p.endDate && startOfDay(next) > startOfDay(p.endDate));
    await this.upcoming.update(p.id, {
      // A finished plan keeps its last due date (for history) and is never due again.
      ...(done ? { completed: true } : { dueDate: next, month: monthKey(next) }),
      anchorDay: anchor,
      history,
      ...(p.endType === 'count' ? { installmentsPaid: paid } : {}),
      ...(entry.skipped ? {} : { lastPaidAt: entry.date }),
    });
  }

  // ── Lending / borrowing ───────────────────────────────────────
  /**
   * Money you lent or borrowed. A TRACKED loan you give is booked as a "Lent" entry on the account it
   * left from (bank, wallet or card), so that account's balance and your spending stay right; repayments
   * come back as income. Borrowed money is ledger-only.
   */
  async addLending(x: {
    direction: LendDirection;
    person: string;
    phone?: string;
    amount: number;
    date: Date;
    dueDate: Date | null;
    track: boolean;
    account: AccountRef | null;
    notes: string;
  }): Promise<Saved> {
    const amount = round(x.amount);
    const person = x.person.trim().slice(0, 60);
    const tracked = x.direction === 'lent' && !!x.track;
    const lent = tracked ? await this.recordExpense(x.account, { description: `Lent: ${person}`, amount, category: 'Lent', date: x.date }) : null;
    const r = await this.receivables.add({
      title: person,
      amount,
      createdAt: x.date,
      date: x.date,
      status: 'PENDING',
      direction: x.direction,
      trackInExpenses: tracked,
      settledAmount: 0,
      ...(normalizePhone(x.phone) ? { phone: normalizePhone(x.phone) } : {}),
      ...(x.dueDate ? { dueDate: x.dueDate } : {}),
      ...(x.notes.trim() ? { notes: x.notes.trim().slice(0, 300) } : {}),
      ...(x.direction === 'lent' && x.account ? { accountType: x.account.type, accountId: x.account.id } : {}),
      ...lentLink(lent?.key ?? null),
    });
    return {
      key: `receivable:${r.id}`,
      undo: async () => {
        await this.receivables.delete(r.id);
        if (lent) await lent.undo();
      },
    };
  }

  /**
   * Records a (partial) repayment. For tracked money you lent, the repayment is income ("Repayment") on
   * the day it's received, into the account it came into. `waiveRest` closes the record and forgives
   * whatever is still outstanding after this payment — forgiven money is never income.
   */
  async settleLending(r: LendingRecord, amount: number, account: AccountRef | null, date = new Date(), waiveRest = false): Promise<void> {
    const pay = Math.min(round(amount), r.outstanding);
    if (!(pay > 0) && !waiveRest) return;
    if (pay > 0 && r.direction === 'lent' && r.trackInExpenses) {
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
    const settled = round(r.settled + Math.max(0, pay));
    const waived = waiveRest ? round(r.waived + Math.max(0, r.outstanding - Math.max(0, pay))) : r.waived;
    const done = settled + waived >= r.amount - 0.005;
    await this.receivables.update(r.id, {
      settledAmount: settled,
      ...(waived > 0 ? { waivedAmount: waived } : {}),
      ...(pay > 0 ? { history: [...r.history, { date, amount: pay }].slice(-24) } : {}),
      ...(done ? { status: 'PAID', paidDate: date, paidInMonth: monthKey(date) } : {}),
    });
  }

  /**
   * Edits a record. The amount can only change while nothing has been repaid (and not for a share of a
   * split, whose shares must add up); its "Lent" entry is re-booked with the new amount.
   */
  async updateLending(r: LendingRecord, f: { person: string; phone: string; amount: number; dueDate: Date | null; notes: string }): Promise<Saved> {
    const person = f.person.trim().slice(0, 60);
    const amount = round(f.amount);
    const amountChanged = Math.abs(amount - r.amount) > 0.004;
    if (amountChanged && !canChangeAmount(r)) throw new Error('The amount can’t change after a repayment, or for a share of a split.');
    const before = r.raw;
    let link: Record<string, unknown> = {};
    let undoEntry: (() => Promise<unknown>) | null = null;
    if (r.lentKey && (amountChanged || person !== r.person)) {
      if (amountChanged) {
        // Re-book the Lent entry (works the same for bank, wallet and card entries).
        const created = await this.recordExpense(r.account, { description: `Lent: ${person}`, amount, category: 'Lent', date: r.date ?? new Date() });
        const old = await this.entrySnapshot(r.lentKey);
        await this.deleteEntry(r.lentKey);
        link = lentLink(created.key);
        undoEntry = async () => {
          await created.undo();
          if (old) await this.recreate(r.account, old);
        };
      } else if (r.lentKey.startsWith('expense:')) {
        const id = r.lentKey.slice(8);
        const old = r.raw?.title ?? r.person;
        await this.expenses.updateExpense({ id, description: `Lent: ${person}` });
        undoEntry = () => this.expenses.updateExpense({ id, description: `Lent: ${old}` });
      }
    }
    const phone = normalizePhone(f.phone);
    await this.receivables.update(r.id, {
      title: person,
      amount,
      phone: phone || deleteField(),
      dueDate: f.dueDate ?? deleteField(),
      notes: f.notes.trim() ? f.notes.trim().slice(0, 300) : deleteField(),
      ...link,
    });
    return {
      key: `receivable:${r.id}`,
      undo: async () => {
        if (undoEntry) await undoEntry();
        await this.receivables.update(r.id, {
          title: before.title,
          amount: before.amount,
          phone: before.phone ?? deleteField(),
          dueDate: before.dueDate ?? deleteField(),
          notes: before.notes ?? deleteField(),
          lentKey: before.lentKey ?? deleteField(),
          lentExpenseId: before.lentExpenseId ?? deleteField(),
        });
      },
    };
  }

  /**
   * Removes a record. If nothing has been repaid, its "Lent" entry goes too (as if the loan never
   * happened). Once money has come back, only the ledger entry goes: the Lent spending and the
   * repayment income both really happened, so removing just one of them would invent income.
   */
  async deleteLending(r: LendingRecord): Promise<void> {
    if (removesLentEntry(r)) await this.deleteEntry(r.lentKey!);
    await this.receivables.delete(r.id);
  }

  /**
   * Removes a whole split: every person's record and Lent entry, and your own share's expense.
   * Not allowed once anyone has repaid (their repayment is already income).
   */
  async deleteSplit(members: LendingRecord[]): Promise<void> {
    if (members.some(m => m.settled > 0)) throw new Error('Someone has already repaid part of this split, so it can’t be deleted as a whole.');
    const own = members.find(m => m.split?.ownKey)?.split?.ownKey ?? null;
    for (const m of members) {
      if (m.lentKey) await this.deleteEntry(m.lentKey).catch(() => undefined);
      await this.receivables.delete(m.id);
    }
    if (own) await this.deleteEntry(own).catch(() => undefined);
  }

  /**
   * "Split this amount": you paid `f.amount`; `people` owe you their shares. Your share (if any) is
   * booked in the expense's own category, each person's share as a separate "Lent" entry on the same
   * account with a lending record — so the account drops by the full amount, the category shows only
   * your part, and each share comes back as income when repaid. Nothing is counted twice.
   * With `existing`, that expense is re-used (for your share, or as the first person's share when you
   * aren't in the split) so links such as email-review approvals are kept.
   */
  async recordSplit(
    acc: AccountRef | null,
    f: ExpenseFields,
    split: { me: number; people: { name: string; phone?: string; share: number }[]; dueDate: Date | null },
    existing: FinanceTxn | null = null
  ): Promise<Saved> {
    const total = round(f.amount);
    const me = round(split.me);
    const people = split.people.map(p => ({ name: p.name.trim().slice(0, 60), phone: normalizePhone(p.phone), share: round(p.share) }));
    const sum = round(me + people.reduce((s, p) => s + p.share, 0));
    if (!people.length || people.some(p => !p.name || !(p.share > 0))) throw new Error('Every person needs a name and a share above ₹0.');
    if (Math.abs(sum - total) > 0.009) throw new Error('The shares don’t add up to the total.');
    const splitId = newId();
    const title = f.description.trim().slice(0, 80) || 'Split';
    const undos: (() => Promise<unknown>)[] = [];
    try {
      // Your own share first (its key is stored on every record).
      let ownKey: string | null = null;
      let reuseForFirst: FinanceTxn | null = null;
      if (me > 0) {
        const s = existing ? await this.updateExpense(existing, acc, { ...f, amount: me }) : await this.recordExpense(acc, { ...f, amount: me });
        ownKey = s.key;
        undos.push(s.undo);
      } else if (existing) {
        reuseForFirst = existing;
      }
      for (const [i, p] of people.entries()) {
        const lf: ExpenseFields = { description: `Lent: ${p.name} · ${title}`.slice(0, 120), amount: p.share, category: 'Lent', date: f.date };
        const s = i === 0 && reuseForFirst ? await this.updateExpense(reuseForFirst, acc, lf) : await this.recordExpense(acc, lf);
        undos.push(s.undo);
        const r = await this.receivables.add({
          title: p.name,
          amount: p.share,
          createdAt: f.date,
          date: f.date,
          status: 'PENDING',
          direction: 'lent',
          trackInExpenses: true,
          settledAmount: 0,
          ...(p.phone ? { phone: p.phone } : {}),
          ...(split.dueDate ? { dueDate: split.dueDate } : {}),
          ...(acc ? { accountType: acc.type, accountId: acc.id } : {}),
          ...lentLink(s.key),
          splitId,
          splitTitle: title,
          splitTotal: total,
          splitCount: people.length + (me > 0 ? 1 : 0),
          splitOwnShare: me,
          ...(ownKey ? { splitOwnKey: ownKey } : {}),
        });
        undos.push(() => this.receivables.delete(r.id));
      }
    } catch (e) {
      // Roll back what was written so a failed split leaves nothing half-done.
      for (const u of undos.reverse()) await u().catch(() => undefined);
      throw e;
    }
    return {
      key: `split:${splitId}`,
      undo: async () => {
        for (const u of [...undos].reverse()) await u();
      },
    };
  }

  // ── helpers for entries referenced by key ('expense:<id>' | 'card:<id>' | 'wallet:<id>') ──
  deleteEntry(key: string): Promise<unknown> {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    switch (kind) {
      case 'expense': return this.expenses.deleteExpense(id);
      case 'card': return this.cardTxns.delete(id);
      case 'wallet': return this.wallets.deleteTxn(id);
      default: return Promise.resolve();
    }
  }

  /** Amount / date / description of a Lent entry before it's re-booked (for undo). */
  private async entrySnapshot(key: string): Promise<ExpenseFields | null> {
    const raw = await this.readEntry(key).catch(() => null);
    if (!raw) return null;
    const date = toDate(raw.date ?? raw.txnDate) ?? new Date();
    return { description: raw.description ?? 'Lent', amount: Number(raw.amount) || 0, category: 'Lent', date };
  }

  private recreate(acc: AccountRef | null, f: ExpenseFields): Promise<Saved> {
    return this.recordExpense(acc, f);
  }

  private async readEntry(key: string): Promise<any | null> {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const col = kind === 'expense' ? 'expenses' : kind === 'card' ? 'card_transactions' : kind === 'wallet' ? 'wallet_transactions' : null;
    if (!col) return null;
    const snap = await getDoc(doc(this.firestore, col, id));
    return snap.exists() ? snap.data() : null;
  }
}

/** Deleting this record also deletes its "Lent" entry (open, tracked, nothing repaid yet). */
export function removesLentEntry(r: LendingRecord): boolean {
  return r.status === 'PENDING' && !!r.lentKey && r.settled === 0;
}

/** Whether a record's amount may still be edited. */
export function canChangeAmount(r: LendingRecord): boolean {
  return r.settled === 0 && r.waived === 0 && !r.split && r.status === 'PENDING';
}

/** Stores the Lent entry's key; bank / no-account entries also keep the older lentExpenseId field. */
function lentLink(key: string | null): Record<string, string> {
  if (!key) return {};
  return key.startsWith('expense:') ? { lentKey: key, lentExpenseId: key.slice(8) } : { lentKey: key };
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID().replace(/-/g, '').slice(0, 20) : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function pick(list: readonly string[], v: string): string {
  // "Lent" is kept on card / wallet entries too, so lent money is recognisable wherever it was paid from.
  if (list.includes(v) || v === 'Lent') return v;
  const alias: Record<string, string> = { Transport: 'Travel', Petrol: 'Fuel', Tickets: 'Entertainment', 'Card Bill': 'Card Payment' };
  return list.includes(alias[v]) ? alias[v] : list.includes('Others') ? 'Others' : list[0];
}
