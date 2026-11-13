/**
 * receivables/{id} — the lending / borrowing ledger.
 *
 * Existing documents are money YOU LENT (title = who, amount, status PENDING|PAID, trackInExpenses,
 * lentExpenseId, paidDate). New optional fields:
 *   direction      'lent' (default) | 'borrowed'
 *   date           when the money changed hands (falls back to createdAt)
 *   dueDate        expected repayment date
 *   settledAmount  repaid so far (partial repayments); PAID once it reaches amount
 *   notes
 *   accountType / accountId  bank account the money left from / came into (lent + tracked only)
 *   history        [{ date, amount }]
 *
 * Budget effect (unchanged rules): a TRACKED loan you give is a "Lent" expense today, and each
 * repayment is income on the day it's received. Borrowed money is ledger-only — borrowing is not
 * income and repaying it is not spending.
 */
import { AccountRef } from './account.model';
import { daysBetween } from '../utils/date-input.util';
import { toDate } from '../utils/firestore.util';

export type LendDirection = 'lent' | 'borrowed';

export interface LendingRecord {
  id: string;
  direction: LendDirection;
  person: string;
  amount: number;
  settled: number;
  outstanding: number;
  status: 'PENDING' | 'PAID';
  date: Date | null;
  dueDate: Date | null;
  trackInExpenses: boolean;
  account: AccountRef | null;
  notes: string;
  history: { date: Date; amount: number }[];
  paidDate: Date | null;
  raw: any;
}

export function lendingFrom(d: any): LendingRecord {
  const amount = Number(d.amount) || 0;
  const status = d.status === 'PAID' ? 'PAID' : 'PENDING';
  const settled = status === 'PAID' ? amount : Math.min(amount, Number(d.settledAmount) || 0);
  return {
    id: d.id,
    direction: d.direction === 'borrowed' ? 'borrowed' : 'lent',
    person: d.title ?? 'Someone',
    amount,
    settled,
    outstanding: Math.max(0, Math.round((amount - settled) * 100) / 100),
    status,
    date: toDate(d.date) ?? toDate(d.createdAt),
    dueDate: toDate(d.dueDate),
    trackInExpenses: !!d.trackInExpenses,
    account: d.accountType && d.accountId ? { type: d.accountType, id: d.accountId } : null,
    notes: d.notes ?? '',
    history: (Array.isArray(d.history) ? d.history : []).map((h: any) => ({ date: toDate(h?.date) ?? new Date(0), amount: Number(h?.amount) || 0 })),
    paidDate: toDate(d.paidDate),
    raw: d,
  };
}

export function lendingDue(r: LendingRecord, today = new Date()): { tone: 'ok' | 'soon' | 'overdue' | 'none'; text: string } {
  if (r.status === 'PAID') return { tone: 'ok', text: 'Settled' };
  if (!r.dueDate) return { tone: 'none', text: 'No due date' };
  const days = daysBetween(today, r.dueDate);
  if (days < 0) return { tone: 'overdue', text: `${-days} day${days === -1 ? '' : 's'} past due` };
  if (days === 0) return { tone: 'soon', text: 'Due today' };
  if (days <= 7) return { tone: 'soon', text: `Due in ${days} day${days === 1 ? '' : 's'}` };
  return { tone: 'ok', text: `Due ${r.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` };
}
