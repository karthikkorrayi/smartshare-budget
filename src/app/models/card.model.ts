import { daysBetween, nextDayOfMonth } from '../utils/date-input.util';

/**
 * cards/{cardId}
 * Only the last four digits are ever stored. Never full card numbers, CVV or PIN.
 * `statementDay` / `dueDay` are the recurring billing cycle (day of month);
 * actual per-cycle dates and amounts live in card_statements.
 */
export const CARD_STATUSES = ['Active', 'Closed'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** 'review' = last change came from an approved email review item. */
export type CardUpdateSource = 'manual' | 'review';

export interface Card {
  id: string;
  userId: string;
  cardholderName: string;
  bankName: string;
  nickname: string;
  lastFourDigits: string;
  expiryMonth: number; // 1–12
  expiryYear: number; // 4-digit
  statementDay: number; // 1–31
  dueDay: number; // 1–31
  status: CardStatus;
  dailySpendingLimit: number; // 0 = none
  createdAt: Date | null;
  lastUpdated: Date | null;
  lastUpdateSource: CardUpdateSource;
}

export type CardInput = Pick<
  Card,
  | 'cardholderName'
  | 'bankName'
  | 'nickname'
  | 'lastFourDigits'
  | 'expiryMonth'
  | 'expiryYear'
  | 'statementDay'
  | 'dueDay'
  | 'status'
  | 'dailySpendingLimit'
>;

/** Fields an email `card_update` review is allowed to change. */
export const CARD_UPDATABLE_FIELDS = ['expiryMonth', 'expiryYear', 'statementDay', 'dueDay'] as const;
export type CardUpdateField = (typeof CARD_UPDATABLE_FIELDS)[number];
export const CARD_FIELD_LABELS: Record<CardUpdateField, string> = {
  expiryMonth: 'Expiry month',
  expiryYear: 'Expiry year',
  statementDay: 'Statement day',
  dueDay: 'Due day',
};

export function cardLabel(c: Pick<Card, 'bankName' | 'nickname' | 'lastFourDigits'>): string {
  return `${c.nickname || c.bankName} ••${c.lastFourDigits}`;
}

/** Card expires at the END of its expiry month. */
export function expiryInfo(c: Pick<Card, 'expiryMonth' | 'expiryYear'>, today = new Date()) {
  const lastDay = new Date(c.expiryYear, c.expiryMonth, 0); // day 0 of next month = last day of expiry month
  const days = daysBetween(today, lastDay);
  const label = `${String(c.expiryMonth).padStart(2, '0')}/${String(c.expiryYear).slice(-2)}`;
  if (days < 0) return { label, days, tone: 'overdue' as const, text: 'Expired' };
  if (days <= 60) return { label, days, tone: 'soon' as const, text: `Expires in ${days} days` };
  return { label, days, tone: 'ok' as const, text: `Valid till ${label}` };
}

export function nextStatementDate(c: Pick<Card, 'statementDay'>, today = new Date()): Date {
  return nextDayOfMonth(c.statementDay, today);
}

export function nextDueDate(c: Pick<Card, 'dueDay'>, today = new Date()): Date {
  return nextDayOfMonth(c.dueDay, today);
}
