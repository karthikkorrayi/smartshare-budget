/**
 * upcoming_payments/{id} — bills and recurring commitments.
 *
 * Existing documents (description, amount, category, dueDate, month, createdAt, [reviewId, importedFrom])
 * keep working unchanged: with no `frequency` they are one-off payments, exactly as before
 * (paying one books an expense and removes it). Optional fields:
 *   frequency      'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
 *   intervalDays   for 'custom'
 *   anchorDay      day of month the schedule keeps to (31 → 28 Feb → 31 Mar), set when the due date is chosen
 *   accountType / accountId   where it is paid from (bank / wallet / card)
 *   reminderDays   days before the due date to start reminding (0–30, default 3)
 *   paused         recurring payment on hold (no reminders, not "due")
 *   history        last 24 payments [{ date, amount, ref, skipped? }]
 *   lastPaidAt
 * Phase 3 (all optional):
 *   amountType     'fixed' (default) | 'variable' — variable bills (electricity…) ask for the actual amount when paid
 *   endType        'never' (default) | 'date' | 'count'
 *   endDate        last due date allowed (endType 'date')
 *   installmentsTotal / installmentsPaid   EMIs and fixed-term plans (endType 'count')
 *   completed      true once the last installment / end date is paid — kept for history, never due again
 *   notify         false = no reminders for this payment (bell or daily push); default true
 *   autopay        true = paid automatically by the bank (still recorded when you mark it paid)
 *   notes
 */
import { AccountRef } from './account.model';
import { daysBetween, monthKey, startOfDay } from '../utils/date-input.util';
import { toDate } from '../utils/firestore.util';

export const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABEL: Record<Frequency, string> = {
  once: 'One time',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  custom: 'Custom interval',
};
/** Noun for "every …" sentences. */
export const FREQUENCY_UNIT: Record<Frequency, string> = {
  once: 'once', daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year', custom: 'interval',
};

export type AmountType = 'fixed' | 'variable';
export type EndType = 'never' | 'date' | 'count';

export interface PaymentHistoryEntry {
  date: Date;
  amount: number;
  ref: string | null; // key of the booked transaction, e.g. 'expense:abc'
  skipped?: boolean;
}

export interface RecurringPayment {
  id: string;
  description: string;
  amount: number;
  category: string;
  dueDate: Date;
  frequency: Frequency;
  intervalDays: number;
  /** Day of month the schedule keeps to. */
  anchorDay: number;
  account: AccountRef | null;
  reminderDays: number;
  paused: boolean;
  history: PaymentHistoryEntry[];
  lastPaidAt: Date | null;
  source: 'manual' | 'email' | 'demo';
  createdAt: Date | null;
  // Phase 3
  amountType: AmountType;
  endType: EndType;
  endDate: Date | null;
  installmentsTotal: number;
  installmentsPaid: number;
  completed: boolean;
  notify: boolean;
  autopay: boolean;
  notes: string;
  raw: any;
}

export type PaymentStatus = 'paused' | 'completed' | 'overdue' | 'today' | 'soon' | 'upcoming';

export function recurringFrom(d: any): RecurringPayment {
  const freq: Frequency = FREQUENCIES.includes(d.frequency) ? d.frequency : 'once';
  const due = toDate(d.dueDate) ?? new Date();
  const anchor = Number(d.anchorDay);
  const endType: EndType = d.endType === 'date' || d.endType === 'count' ? d.endType : 'never';
  return {
    id: d.id,
    description: d.description ?? 'Payment',
    amount: Number(d.amount) || 0,
    category: d.category ?? 'Bills',
    dueDate: due,
    frequency: freq,
    intervalDays: Math.max(1, Number(d.intervalDays) || 30),
    anchorDay: anchor >= 1 && anchor <= 31 ? Math.trunc(anchor) : due.getDate(),
    account: d.accountType && d.accountId ? { type: d.accountType, id: d.accountId } : null,
    reminderDays: Number.isFinite(Number(d.reminderDays)) && d.reminderDays !== null && d.reminderDays !== undefined ? Math.min(30, Math.max(0, Number(d.reminderDays))) : 3,
    paused: !!d.paused,
    history: (Array.isArray(d.history) ? d.history : [])
      .map((h: any) => ({ date: toDate(h?.date) ?? new Date(0), amount: Number(h?.amount) || 0, ref: h?.ref ?? null, skipped: !!h?.skipped }))
      .sort((a: PaymentHistoryEntry, b: PaymentHistoryEntry) => b.date.getTime() - a.date.getTime()),
    lastPaidAt: toDate(d.lastPaidAt),
    source: d.importedFrom === 'email' ? 'email' : d.importedFrom === 'demo' ? 'demo' : 'manual',
    createdAt: toDate(d.createdAt),
    amountType: d.amountType === 'variable' ? 'variable' : 'fixed',
    endType,
    endDate: toDate(d.endDate),
    installmentsTotal: Math.max(0, Math.trunc(Number(d.installmentsTotal) || 0)),
    installmentsPaid: Math.max(0, Math.trunc(Number(d.installmentsPaid) || 0)),
    completed: !!d.completed,
    notify: d.notify !== false,
    autopay: !!d.autopay,
    notes: d.notes ?? '',
    raw: d,
  };
}

/** The due date one period after `from` (month-end safe: 31 Jan → 28/29 Feb → 31 Mar keeps the anchor day). */
export function nextOccurrence(from: Date, freq: Frequency, intervalDays = 30, anchorDay = from.getDate()): Date {
  const y = from.getFullYear(), m = from.getMonth(), d = from.getDate();
  const clampMonth = (yy: number, mm: number) => {
    const last = new Date(yy, mm + 1, 0).getDate();
    return new Date(yy, mm, Math.min(anchorDay, last), 12);
  };
  switch (freq) {
    case 'daily': return new Date(y, m, d + 1, 12);
    case 'weekly': return new Date(y, m, d + 7, 12);
    case 'monthly': return clampMonth(y, m + 1);
    case 'quarterly': return clampMonth(y, m + 3);
    case 'yearly': return clampMonth(y + 1, m);
    case 'custom': return new Date(y, m, d + Math.max(1, intervalDays), 12);
    default: return from;
  }
}

type SchedInput = Pick<RecurringPayment, 'dueDate' | 'frequency' | 'intervalDays'> &
  Partial<Pick<RecurringPayment, 'anchorDay' | 'endType' | 'endDate' | 'installmentsTotal' | 'installmentsPaid' | 'completed'>>;

/** How many more payments are allowed from the current due date on (Infinity = no end). */
export function paymentsLeft(p: SchedInput): number {
  if (p.completed) return 0;
  if (p.frequency === 'once') return 1;
  if (p.endType === 'count') return Math.max(0, (p.installmentsTotal ?? 0) - (p.installmentsPaid ?? 0));
  if (p.endType === 'date' && p.endDate) {
    const end = startOfDay(p.endDate).getTime();
    if (startOfDay(p.dueDate).getTime() > end) return 0;
    let n = 0;
    let d = p.dueDate;
    const anchor = p.anchorDay ?? p.dueDate.getDate();
    while (startOfDay(d).getTime() <= end && n < 5000) {
      n++;
      d = nextOccurrence(d, p.frequency, p.intervalDays, anchor);
    }
    return n;
  }
  return Infinity;
}

/** Next due dates from the current one (stops at the end date / last installment). */
export function schedule(p: SchedInput, n = 6): Date[] {
  const left = paymentsLeft(p);
  if (left === 0) return [];
  if (p.frequency === 'once') return [p.dueDate];
  const anchor = p.anchorDay ?? p.dueDate.getDate();
  const out = [p.dueDate];
  while (out.length < Math.min(n, left)) out.push(nextOccurrence(out[out.length - 1], p.frequency, p.intervalDays, anchor));
  return out;
}

/**
 * Due dates falling in [from, to] (whole days), walking forward from the current due date.
 * `includeOverdue`: also count the current due date when it is before `from` (it is unpaid = overdue).
 */
export function occurrencesBetween(p: SchedInput, from: Date, to: Date, includeOverdue = false, max = 400): Date[] {
  const left = paymentsLeft(p);
  if (left === 0) return [];
  const f = startOfDay(from).getTime();
  const e = startOfDay(to).getTime();
  const anchor = p.anchorDay ?? p.dueDate.getDate();
  const out: Date[] = [];
  let d = p.dueDate;
  for (let i = 0; i < Math.min(left, max) && startOfDay(d).getTime() <= e; i++) {
    const t = startOfDay(d).getTime();
    if (t >= f || (i === 0 && includeOverdue)) out.push(d);
    if (p.frequency === 'once') break;
    d = nextOccurrence(d, p.frequency, p.intervalDays, anchor);
  }
  return out;
}

export function statusOf(p: RecurringPayment, today = new Date()): { status: PaymentStatus; days: number; text: string } {
  const days = daysBetween(today, p.dueDate);
  if (p.completed) return { status: 'completed', days, text: 'Completed' };
  if (p.paused) return { status: 'paused', days, text: 'Paused' };
  if (days < 0) return { status: 'overdue', days, text: `Overdue by ${-days} day${days === -1 ? '' : 's'}` };
  if (days === 0) return { status: 'today', days, text: 'Due today' };
  if (days <= Math.max(p.reminderDays, 3)) return { status: 'soon', days, text: days === 1 ? 'Due tomorrow' : `Due in ${days} days` };
  return { status: 'upcoming', days, text: `Due in ${days} days` };
}

/** Paid (not skipped) in the given 'YYYY-MM'. */
export function paidInMonth(p: RecurringPayment, month = monthKey()): PaymentHistoryEntry[] {
  return p.history.filter(h => !h.skipped && monthKey(h.date) === month);
}

/** Average monthly cost of a commitment (for "total committed per month"). */
export function monthlyEquivalent(p: Pick<RecurringPayment, 'amount' | 'frequency' | 'intervalDays'>): number {
  const a = p.amount;
  switch (p.frequency) {
    case 'daily': return (a * 365) / 12;
    case 'weekly': return (a * 52) / 12;
    case 'monthly': return a;
    case 'quarterly': return a / 3;
    case 'yearly': return a / 12;
    case 'custom': return (a * 365) / 12 / Math.max(1, p.intervalDays);
    default: return 0;
  }
}

/** Payments per year (0 for one-time). */
export function perYear(p: Pick<RecurringPayment, 'frequency' | 'intervalDays'>): number {
  switch (p.frequency) {
    case 'daily': return 365;
    case 'weekly': return 52;
    case 'monthly': return 12;
    case 'quarterly': return 4;
    case 'yearly': return 1;
    case 'custom': return 365 / Math.max(1, p.intervalDays);
    default: return 0;
  }
}

export interface PlanSummary {
  /** "₹1,499 every month on the 5th" */
  sentence: string;
  monthly: number;
  yearly: number;
  /** Remaining payments (null = no end). */
  left: number | null;
  /** Remaining total (null = no end). */
  remainingTotal: number | null;
  lastDate: Date | null;
  next: Date[];
  /** Due dates in the current calendar month and their total. */
  thisMonth: { count: number; total: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Everything the form and the details panel explain about a plan, worked out the same way the app pays it. */
export function planSummary(p: SchedInput & Pick<RecurringPayment, 'amount'> & Partial<Pick<RecurringPayment, 'amountType'>>, today = new Date()): PlanSummary {
  const left = paymentsLeft(p);
  const finite = Number.isFinite(left);
  const anchor = p.anchorDay ?? p.dueDate.getDate();
  const amt = inr(p.amount) + (p.amountType === 'variable' ? ' (about)' : '');
  let when: string;
  switch (p.frequency) {
    case 'once': when = `once, on ${p.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`; break;
    case 'daily': when = 'every day'; break;
    case 'weekly': when = `every ${p.dueDate.toLocaleDateString('en-IN', { weekday: 'long' })}`; break;
    case 'monthly': when = `every month on the ${ord(anchor)}`; break;
    case 'quarterly': when = `every 3 months on the ${ord(anchor)}`; break;
    case 'yearly': when = `every year on ${p.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`; break;
    case 'custom': when = `every ${p.intervalDays} days`; break;
  }
  const next = schedule(p, finite ? Math.min(6, left) : 6);
  let lastDate: Date | null = null;
  if (finite && left > 0) lastDate = p.frequency === 'once' ? p.dueDate : schedule(p, left)[left - 1] ?? null;
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const inMonth = occurrencesBetween(p, mStart, mEnd);
  const monthly = p.frequency === 'once' ? 0 : r2(monthlyEquivalent(p));
  return {
    sentence: `${amt} ${when}`,
    monthly,
    yearly: p.frequency === 'once' ? 0 : r2(p.amount * perYear(p)),
    left: finite ? left : null,
    remainingTotal: finite ? r2(left * p.amount) : null,
    lastDate,
    next,
    thisMonth: { count: inMonth.length, total: r2(inMonth.length * p.amount) },
  };
}

/** What an edit changes, in plain words (shown before saving an edit). */
export function describeChanges(before: RecurringPayment, after: SchedInput & Pick<RecurringPayment, 'amount' | 'description'> & Partial<RecurringPayment>): string[] {
  const out: string[] = [];
  if (before.description !== after.description) out.push(`Name: "${before.description}" → "${after.description}"`);
  if (before.amount !== after.amount) {
    const diff = after.amount - before.amount;
    const m = after.frequency === 'once' ? '' : ` (${diff > 0 ? '+' : '−'}${inr(Math.abs(r2(monthlyEquivalent({ ...after, amount: Math.abs(diff) }))))} a month)`;
    out.push(`Amount: ${inr(before.amount)} → ${inr(after.amount)}${m}`);
  }
  if (before.frequency !== after.frequency || (after.frequency === 'custom' && before.intervalDays !== after.intervalDays)) {
    out.push(`Repeats: ${FREQUENCY_LABEL[before.frequency]} → ${FREQUENCY_LABEL[after.frequency]}${after.frequency === 'custom' ? ` (every ${after.intervalDays} days)` : ''}`);
  }
  if (startOfDay(before.dueDate).getTime() !== startOfDay(after.dueDate).getTime()) {
    const f = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    out.push(`Next due: ${f(before.dueDate)} → ${f(after.dueDate)}`);
  }
  if ((after.endType ?? 'never') !== before.endType || (after.installmentsTotal ?? 0) !== before.installmentsTotal || (after.endDate?.getTime() ?? 0) !== (before.endDate?.getTime() ?? 0)) {
    out.push('End of the plan changed');
  }
  if (after.account !== undefined && JSON.stringify(after.account) !== JSON.stringify(before.account)) out.push('Paid-from account changed');
  return out;
}
