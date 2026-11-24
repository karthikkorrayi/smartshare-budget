/**
 * loans/{id} — money you borrowed from a bank or lender and repay in EMIs (Phase 6).
 *   name, lender, kind, principal, rate (annual %, reducing balance), tenureMonths, firstEmiDate,
 *   emi (what you actually pay; defaults to the standard formula), paidBefore (EMIs already paid when
 *   you added it), accountType/accountId (paid from), recurringId (the EMI's recurring payment, which
 *   sends reminders and books each EMI as an expense), status 'active' | 'closed', closedAt, notes.
 *
 * Outstanding = the principal still owed after the EMIs paid so far (standard amortization: each
 * month's interest is balance × rate / 12, the rest of the EMI repays principal). With a linked EMI
 * payment, "paid so far" is its installment count, so marking an EMI paid moves the loan on; without
 * one, every EMI date up to today counts as paid.
 * In net worth the loan counts as its outstanding principal — its EMI payment isn't counted again.
 */
import { AccountRef } from './account.model';
import { toDate } from '../utils/firestore.util';

export type LoanKind = 'home' | 'car' | 'personal' | 'education' | 'gold' | 'consumer' | 'other';
export const LOAN_KINDS: { id: LoanKind; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'house' },
  { id: 'car', label: 'Vehicle', icon: 'car' },
  { id: 'personal', label: 'Personal', icon: 'user' },
  { id: 'education', label: 'Education', icon: 'graduation-cap' },
  { id: 'gold', label: 'Gold', icon: 'gem' },
  { id: 'consumer', label: 'Consumer / EMI', icon: 'shopping-bag' },
  { id: 'other', label: 'Other', icon: 'landmark' },
];

export interface Loan {
  id: string;
  name: string;
  lender: string;
  kind: LoanKind;
  principal: number;
  rate: number;
  tenureMonths: number;
  firstEmiDate: Date;
  emi: number;
  paidBefore: number;
  account: AccountRef | null;
  recurringId: string | null;
  status: 'active' | 'closed';
  closedAt: Date | null;
  notes: string;
  raw: any;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function loanFrom(d: any): Loan {
  const kind = LOAN_KINDS.some(k => k.id === d.kind) ? (d.kind as LoanKind) : 'other';
  const principal = Math.max(0, Number(d.principal) || 0);
  const rate = Math.max(0, Number(d.rate) || 0);
  const tenure = Math.max(1, Math.round(Number(d.tenureMonths) || 1));
  const accType = d.accountType === 'bank' || d.accountType === 'wallet' || d.accountType === 'card' ? d.accountType : null;
  return {
    id: d.id,
    name: d.name ?? 'Loan',
    lender: d.lender ?? '',
    kind,
    principal,
    rate,
    tenureMonths: tenure,
    firstEmiDate: toDate(d.firstEmiDate) ?? new Date(),
    emi: Number(d.emi) > 0 ? Number(d.emi) : standardEmi(principal, rate, tenure),
    paidBefore: Math.max(0, Math.round(Number(d.paidBefore) || 0)),
    account: accType && d.accountId ? { type: accType, id: d.accountId } : null,
    recurringId: typeof d.recurringId === 'string' && d.recurringId ? d.recurringId : null,
    status: d.status === 'closed' ? 'closed' : 'active',
    closedAt: toDate(d.closedAt),
    notes: d.notes ?? '',
    raw: d,
  };
}

/**
 * EMI for a reducing-balance loan: P·r·(1+r)^n / ((1+r)^n − 1), r = monthly rate. 0 % → P / n.
 * Rounded UP to the paisa (as banks do), so the loan is repaid within the tenure, never a month later.
 */
export function standardEmi(principal: number, ratePct: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = ratePct / 1200;
  const raw = r <= 0 ? principal / months : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  return Math.ceil(Math.round(raw * 1e6) / 1e4) / 100;
}

/** i-th EMI date (0-based): monthly, keeping the first EMI's day (31st → 28/29/30 in short months). */
export function emiDate(first: Date, i: number): Date {
  const day = first.getDate();
  const y = first.getFullYear(), m = first.getMonth() + i;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last), 12);
}

export interface AmortRow {
  n: number;
  date: Date;
  emi: number;
  interest: number;
  principal: number;
  /** Owed after this EMI. */
  balance: number;
}

/**
 * Month-by-month schedule until the balance is repaid, paying `emi` each month (the last EMI is
 * whatever is left). Empty when the EMI doesn't even cover the first month's interest.
 */
export function amortize(principal: number, ratePct: number, emi: number, first: Date, max = 600): AmortRow[] {
  const r = ratePct / 1200;
  if (!(principal > 0) || !(emi > 0) || emi <= principal * r) return [];
  const rows: AmortRow[] = [];
  let bal = principal;
  for (let i = 0; i < max && bal > 0.004; i++) {
    const interest = r2(bal * r);
    let pay = emi;
    // Last EMI: whatever is left, absorbing the paise of monthly interest rounding (up to 1 % of an EMI).
    if (bal + interest <= emi + Math.max(1, emi * 0.01)) pay = r2(bal + interest);
    const princ = r2(pay - interest);
    bal = r2(Math.max(0, bal - princ));
    rows.push({ n: i + 1, date: emiDate(first, i), emi: pay, interest, principal: princ, balance: bal });
  }
  return rows;
}

export interface LoanStatus {
  rows: AmortRow[];
  /** EMIs paid so far. */
  paid: number;
  total: number;
  outstanding: number;
  principalPaid: number;
  interestPaid: number;
  interestLeft: number;
  totalInterest: number;
  totalPayable: number;
  nextDate: Date | null;
  endDate: Date | null;
  /** Share of the principal repaid, 0–1. */
  progress: number;
  /** The EMI doesn't cover the interest — the loan would never be repaid. */
  invalid: boolean;
}

/**
 * How many EMIs are paid: closed → all; linked EMI payment → its count; else EMI dates BEFORE today
 * (an EMI due today may not have gone out yet).
 */
export function paidCount(loan: Loan, plan: { installmentsPaid: number } | null, rows: AmortRow[], today = new Date()): number {
  if (loan.status === 'closed') return rows.length;
  if (plan) return Math.min(rows.length, Math.max(0, plan.installmentsPaid));
  return Math.min(rows.length, datesBefore(rows, today));
}

/** EMI dates before today's date. */
export function datesBefore(rows: { date: Date }[], today = new Date()): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return rows.filter(r => r.date.getTime() < t).length;
}

export function loanStatus(loan: Loan, plan: { installmentsPaid: number } | null = null, today = new Date()): LoanStatus {
  const rows = amortize(loan.principal, loan.rate, loan.emi, loan.firstEmiDate);
  if (!rows.length) {
    return { rows, paid: 0, total: 0, outstanding: loan.status === 'closed' ? 0 : loan.principal, principalPaid: 0, interestPaid: 0, interestLeft: 0, totalInterest: 0,
      totalPayable: 0, nextDate: null, endDate: null, progress: 0, invalid: true };
  }
  const paid = paidCount(loan, plan, rows, today);
  const done = rows.slice(0, paid);
  const sum = (xs: AmortRow[], k: 'interest' | 'principal' | 'emi') => r2(xs.reduce((s, x) => s + x[k], 0));
  const totalInterest = sum(rows, 'interest');
  const interestPaid = sum(done, 'interest');
  const outstanding = loan.status === 'closed' ? 0 : paid ? rows[paid - 1].balance : loan.principal;
  return {
    rows,
    paid,
    total: rows.length,
    outstanding,
    principalPaid: r2(loan.principal - outstanding),
    interestPaid,
    interestLeft: loan.status === 'closed' ? 0 : r2(totalInterest - interestPaid),
    totalInterest,
    totalPayable: sum(rows, 'emi'),
    nextDate: loan.status === 'closed' || paid >= rows.length ? null : rows[paid].date,
    endDate: rows[rows.length - 1].date,
    progress: loan.principal ? Math.min(1, (loan.principal - outstanding) / loan.principal) : 1,
    invalid: false,
  };
}
