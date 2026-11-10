import { daysBetween } from '../utils/date-input.util';
import { TxnSource } from './card-transaction.model';

/** card_statements/{statementId} — one billing cycle of one card. */
export const STATEMENT_STATUSES = ['Unpaid', 'Partially Paid', 'Paid'] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export interface CardStatement {
  id: string;
  userId: string;
  cardId: string;
  statementDate: Date;
  dueDate: Date;
  totalDue: number;
  minDue: number;
  paidAmount: number;
  status: StatementStatus;
  source: TxnSource;
  reviewId: string | null;
  createdAt: Date | null;
  lastUpdated: Date | null;
}

export type StatementInput = Pick<
  CardStatement,
  'cardId' | 'statementDate' | 'dueDate' | 'totalDue' | 'minDue' | 'paidAmount' | 'status'
>;

/** Status implied by amounts — used to keep status and paidAmount consistent. */
export function statusFromPaid(totalDue: number, paidAmount: number): StatementStatus {
  if (paidAmount <= 0) return totalDue <= 0 ? 'Paid' : 'Unpaid';
  return paidAmount >= totalDue ? 'Paid' : 'Partially Paid';
}

export function dueInfo(s: Pick<CardStatement, 'dueDate' | 'status' | 'totalDue' | 'paidAmount'>, today = new Date()) {
  const days = daysBetween(today, s.dueDate);
  const outstanding = Math.max(0, s.totalDue - s.paidAmount);
  if (s.status === 'Paid') return { days, outstanding, tone: 'ok' as const, text: 'Paid' };
  if (days < 0) return { days, outstanding, tone: 'overdue' as const, text: `Overdue by ${-days} day${days === -1 ? '' : 's'}` };
  if (days === 0) return { days, outstanding, tone: 'overdue' as const, text: 'Due today' };
  if (days <= 7) return { days, outstanding, tone: 'soon' as const, text: `Due in ${days} day${days === 1 ? '' : 's'}` };
  return { days, outstanding, tone: 'ok' as const, text: `Due in ${days} days` };
}
