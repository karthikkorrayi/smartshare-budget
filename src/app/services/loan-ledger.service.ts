import { Injectable, inject } from '@angular/core';
import { deleteField } from '@angular/fire/firestore';
import { LoanService } from './loan.service';
import { LedgerService, Saved } from './ledger.service';
import { UpcomingPaymentService } from './upcoming-payment.service';
import { AccountRef } from '../models/account.model';
import { Loan, LoanKind, amortize } from '../models/loan.model';
import { RecurringPayment } from '../models/recurring.model';

export interface LoanFields {
  name: string;
  lender: string;
  kind: LoanKind;
  principal: number;
  rate: number;
  tenureMonths: number;
  firstEmiDate: Date;
  emi: number;
  /** EMIs already paid before the loan was added. */
  paidBefore: number;
  account: AccountRef | null;
  notes: string;
  autopay: boolean;
}

/** What to do about the loan's monthly EMI payment (the recurring payment that reminds you and books each EMI). */
export type EmiPlanChoice = { kind: 'create' } | { kind: 'link'; planId: string } | { kind: 'none' } | { kind: 'keep' };

const r2 = (n: number) => Math.round(Number(n) * 100) / 100;

/**
 * Loans with their EMI payment. Creating a loan can create its monthly EMI as a recurring payment
 * (category EMI, fixed amount, ends after the remaining EMIs) — that's what sends reminders and books
 * each EMI as an expense via "Mark paid", and its installment count moves the loan's outstanding.
 */
@Injectable({ providedIn: 'root' })
export class LoanLedgerService {
  private loans = inject(LoanService);
  private ledger = inject(LedgerService);
  private upcoming = inject(UpcomingPaymentService);

  async saveLoan(existing: Loan | null, f: LoanFields, plan: EmiPlanChoice, plans: RecurringPayment[]): Promise<Saved> {
    const rows = amortize(f.principal, f.rate, f.emi, f.firstEmiDate);
    if (!rows.length) throw new Error('The EMI must be more than the first month’s interest.');
    const paid = Math.min(rows.length, Math.max(0, Math.round(f.paidBefore)));
    const data: Record<string, unknown> = {
      name: f.name.trim().slice(0, 60),
      lender: f.lender.trim().slice(0, 60),
      kind: f.kind,
      principal: r2(f.principal),
      rate: r2(f.rate),
      tenureMonths: Math.round(f.tenureMonths),
      firstEmiDate: f.firstEmiDate,
      emi: r2(f.emi),
      paidBefore: paid,
      accountType: f.account?.type ?? null,
      accountId: f.account?.id ?? null,
      status: existing?.status ?? 'active',
      notes: f.notes.trim().slice(0, 300),
    };
    const undos: (() => Promise<unknown>)[] = [];

    let loanId = existing?.id ?? '';
    if (existing) {
      const before = existing.raw;
      await this.loans.update(existing.id, data);
      undos.push(() => this.loans.update(existing.id, pickBack(before, Object.keys(data))));
    } else {
      const r = await this.loans.add({ ...data, recurringId: null });
      loanId = r.id;
      undos.push(() => this.loans.delete(r.id));
    }

    const linked = existing?.recurringId ? plans.find(p => p.id === existing.recurringId) ?? null : null;
    if (plan.kind === 'create' && paid < rows.length) {
      const planId = await this.ledger.saveRecurring(null, this.planDoc(data, rows, paid, loanId, f.autopay));
      await this.loans.update(loanId, { recurringId: planId });
      undos.push(() => this.upcoming.delete(planId));
    } else if (plan.kind === 'link') {
      const p = plans.find(x => x.id === plan.planId);
      if (!p) throw new Error('That EMI payment no longer exists.');
      const done = Math.min(rows.length, p.installmentsPaid);
      const change = {
        category: 'EMI', endType: 'count', installmentsTotal: rows.length, installmentsPaid: done, amount: r2(f.emi),
        loanId, completed: done >= rows.length,
      };
      await this.upcoming.update(p.id, change);
      undos.push(() => this.upcoming.update(p.id, pickBack(p.raw, Object.keys(change))));
      await this.loans.update(loanId, { recurringId: p.id });
    } else if (plan.kind === 'none' && existing?.recurringId) {
      await this.loans.update(loanId, { recurringId: null });
    } else if (plan.kind === 'keep' && linked) {
      // Keep the EMI payment in step with the loan's terms (its paid count stays as it is).
      const done = Math.min(rows.length, linked.installmentsPaid);
      const change: Record<string, unknown> = {
        description: `${data['name']} EMI`, amount: r2(f.emi), installmentsTotal: rows.length, anchorDay: f.firstEmiDate.getDate(),
        accountType: f.account?.type ?? null, accountId: f.account?.id ?? null, autopay: f.autopay, completed: done >= rows.length,
        ...(done < rows.length ? { dueDate: rows[done].date } : {}),
      };
      await this.ledger.saveRecurring(linked.id, { ...change, dueDate: change['dueDate'] ?? linked.dueDate });
      undos.push(() => this.upcoming.update(linked.id, pickBack(linked.raw, [...Object.keys(change), 'dueDate', 'month'])));
    }
    return { key: `loan:${loanId}`, undo: async () => { for (const u of undos.reverse()) await u(); } };
  }

  private planDoc(d: Record<string, unknown>, rows: { date: Date }[], paid: number, loanId: string, autopay: boolean): Record<string, unknown> {
    const first = d['firstEmiDate'] as Date;
    return {
      description: `${d['name']} EMI`,
      amount: d['emi'],
      amountType: 'fixed',
      category: 'EMI',
      dueDate: rows[paid].date,
      frequency: 'monthly',
      intervalDays: null,
      anchorDay: first.getDate(),
      endType: 'count',
      endDate: null,
      installmentsTotal: rows.length,
      installmentsPaid: paid,
      accountType: d['accountType'],
      accountId: d['accountId'],
      reminderDays: 3,
      notify: true,
      autopay,
      paused: false,
      notes: 'EMI of a loan — edit the loan under Net worth.',
      loanId,
    };
  }

  /** Paid off / foreclosed: owes nothing from now on, and its EMI payment stops. */
  async close(loan: Loan, plan: RecurringPayment | null): Promise<void> {
    await this.loans.update(loan.id, { status: 'closed', closedAt: new Date() });
    if (plan && !plan.completed) await this.upcoming.update(plan.id, { completed: true });
  }

  async reopen(loan: Loan, plan: RecurringPayment | null): Promise<void> {
    await this.loans.update(loan.id, { status: 'active', closedAt: deleteField() });
    if (plan && plan.completed && plan.installmentsPaid < plan.installmentsTotal) await this.upcoming.update(plan.id, { completed: false });
  }

  /** Removes the loan (and, if asked, its EMI payment). EMIs already paid stay in your expenses. */
  async delete(loan: Loan, withPlan: boolean): Promise<void> {
    if (withPlan && loan.recurringId) await this.upcoming.delete(loan.recurringId).catch(() => undefined);
    await this.loans.delete(loan.id);
  }
}

/** The previous values of `keys` (deleting the ones that weren't there), for undo. */
function pickBack(before: any, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = before && k in before ? before[k] : deleteField();
  return out;
}
