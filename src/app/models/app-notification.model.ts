/**
 * notifications/{id} — event notifications (something happened).
 * Written by Cloud Functions in later phases (origin 'system'); the sample loader writes origin 'demo'.
 *
 * Date-based reminders (statement in 2 days, payment due, overdue, card expiring) are NOT stored:
 * they are computed live from cards + statements, so they can never go stale.
 */
export const NOTIFICATION_TYPES = [
  'new_transaction',
  'statement_generated',
  'statement_upcoming',
  'payment_due',
  'payment_reminder',
  'card_updated',
  'review_pending',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  cardId: string | null;
  link: string | null; // in-app route, e.g. '/review'
  read: boolean;
  origin: 'system' | 'demo';
  createdAt: Date | null;
  readAt: Date | null;
}

/** A live, computed reminder (not stored). */
export interface Reminder {
  key: string;
  type: 'statement_upcoming' | 'payment_due' | 'payment_overdue' | 'card_expiring';
  tone: 'soon' | 'overdue';
  title: string;
  body: string;
  date: Date;
  cardId: string;
  link: string;
}

export const NOTIFICATION_ICONS: Record<string, string> = {
  new_transaction: '💳',
  statement_generated: '🧾',
  statement_upcoming: '🗓️',
  payment_due: '⏰',
  payment_reminder: '⏰',
  payment_overdue: '⚠️',
  card_updated: '✏️',
  card_expiring: '⌛',
  review_pending: '🔍',
};
