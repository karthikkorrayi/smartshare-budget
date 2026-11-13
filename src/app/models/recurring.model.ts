/**
 * upcoming_payments/{id} — bills and recurring commitments.
 *
 * Existing documents (description, amount, category, dueDate, month, createdAt, [reviewId, importedFrom])
 * keep working unchanged: with no `frequency` they are one-off payments, exactly as before
 * (paying one books an expense and removes it). New optional fields:
 *   frequency      'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
 *   intervalDays   for 'custom'
 *   accountType / accountId   where it is paid from (bank / wallet / card)
 *   reminderDays   days before the due date to start reminding (0–30, default 3)
 *   paused         recurring payment on hold (no reminders, not "due")
 *   history        last 24 payments [{ date, amount, ref, skipped? }]
 *   lastPaidAt
 */
import { AccountRef } from './account.model';
import { daysBetween, monthKey } from '../utils/date-input.util';
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
  account: AccountRef | null;
  reminderDays: number;
  paused: boolean;
  history: PaymentHistoryEntry[];
  lastPaidAt: Date | null;
  source: 'manual' | 'email' | 'demo';
  createdAt: Date | null;
  raw: any;
}

export type PaymentStatus = 'paused' | 'overdue' | 'today' | 'soon' | 'upcoming';

export function recurringFrom(d: any): RecurringPayment {
  const freq: Frequency = FREQUENCIES.includes(d.frequency) ? d.frequency : 'once';
  return {
    id: d.id,
    description: d.description ?? 'Payment',
    amount: Number(d.amount) || 0,
    category: d.category ?? 'Bills',
    dueDate: toDate(d.dueDate) ?? new Date(),
    frequency: freq,
    intervalDays: Math.max(1, Number(d.intervalDays) || 30),
    account: d.accountType && d.accountId ? { type: d.accountType, id: d.accountId } : null,
    reminderDays: Number.isFinite(Number(d.reminderDays)) && d.reminderDays !== null && d.reminderDays !== undefined ? Math.min(30, Math.max(0, Number(d.reminderDays))) : 3,
    paused: !!d.paused,
    history: (Array.isArray(d.history) ? d.history : [])
      .map((h: any) => ({ date: toDate(h?.date) ?? new Date(0), amount: Number(h?.amount) || 0, ref: h?.ref ?? null, skipped: !!h?.skipped }))
      .sort((a: PaymentHistoryEntry, b: PaymentHistoryEntry) => b.date.getTime() - a.date.getTime()),
    lastPaidAt: toDate(d.lastPaidAt),
    source: d.importedFrom === 'email' ? 'email' : d.importedFrom === 'demo' ? 'demo' : 'manual',
    createdAt: toDate(d.createdAt),
    raw: d,
  };
}

/** The due date one period after `from` (month-end safe: 31 Jan → 28/29 Feb → 31 Mar keeps the day where possible). */
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

/** Next N due dates (for the schedule preview). */
export function schedule(p: Pick<RecurringPayment, 'dueDate' | 'frequency' | 'intervalDays'>, n = 6): Date[] {
  if (p.frequency === 'once') return [p.dueDate];
  const anchor = p.dueDate.getDate();
  const out = [p.dueDate];
  while (out.length < n) out.push(nextOccurrence(out[out.length - 1], p.frequency, p.intervalDays, anchor));
  return out;
}

export function statusOf(p: RecurringPayment, today = new Date()): { status: PaymentStatus; days: number; text: string } {
  const days = daysBetween(today, p.dueDate);
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

/** Rough monthly cost of a commitment (for "total committed per month"). */
export function monthlyEquivalent(p: Pick<RecurringPayment, 'amount' | 'frequency' | 'intervalDays'>): number {
  const a = p.amount;
  switch (p.frequency) {
    case 'daily': return a * 30;
    case 'weekly': return (a * 52) / 12;
    case 'monthly': return a;
    case 'quarterly': return a / 3;
    case 'yearly': return a / 12;
    case 'custom': return (a * 30) / Math.max(1, p.intervalDays);
    default: return 0;
  }
}
