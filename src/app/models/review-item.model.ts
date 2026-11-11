/**
 * review_items/{reviewId} — the centralized Review Center.
 *
 * Created by the Gmail sync Cloud Function (origin 'gmail') or by "Load samples" (origin 'demo').
 * `category` = what the email IS (salary credit, card statement…), suggested by the classifier.
 * `kind`     = where it GOES once approved (Income, Expenses, Upcoming payments, Card transactions,
 *              Card statements, Card details). The reviewer can change it.
 * Firestore rules only accept the destination record when it is written in the same batch that
 * approves this item, so unreviewed email data can never become verified data.
 */
export const REVIEW_KINDS = ['income', 'expense', 'bill', 'transaction', 'statement', 'card_update'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export type ReviewOrigin = 'gmail' | 'demo';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export const EMAIL_CATEGORIES = [
  'salary_credit',
  'bank_credit',
  'bank_debit',
  'card_transaction',
  'card_statement',
  'bill_generated',
  'payment_due',
  'payment_confirmation',
  'card_update',
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const CATEGORY_INFO: Record<EmailCategory, { label: string; icon: string; group: 'salary' | 'bank' | 'cards' | 'bills' | 'payments' }> = {
  salary_credit: { label: 'Salary credit', icon: '💰', group: 'salary' },
  bank_credit: { label: 'Bank credit', icon: '⬇️', group: 'bank' },
  bank_debit: { label: 'Bank debit', icon: '⬆️', group: 'bank' },
  card_transaction: { label: 'Card transaction', icon: '💳', group: 'cards' },
  card_statement: { label: 'Card statement', icon: '📄', group: 'cards' },
  card_update: { label: 'Card details change', icon: '✏️', group: 'cards' },
  bill_generated: { label: 'Bill generated', icon: '🧾', group: 'bills' },
  payment_due: { label: 'Payment due', icon: '⏰', group: 'bills' },
  payment_confirmation: { label: 'Payment confirmation', icon: '✅', group: 'payments' },
};

export const KIND_INFO: Record<ReviewKind, { label: string; module: string; needsCard: boolean }> = {
  income: { label: 'Income', module: 'Overview → Income', needsCard: false },
  expense: { label: 'Expense', module: 'Overview → Expenses', needsCard: false },
  bill: { label: 'Upcoming payment', module: 'Overview → Upcoming payments', needsCard: false },
  transaction: { label: 'Card transaction', module: 'Cards → Transactions', needsCard: true },
  statement: { label: 'Card statement', module: 'Cards → Statements', needsCard: true },
  card_update: { label: 'Card details', module: 'Cards → card details', needsCard: true },
};

/** Destinations a reviewer may switch between (card_update stays card_update). */
export const SWITCHABLE_KINDS: ReviewKind[] = ['income', 'expense', 'bill', 'transaction', 'statement'];

/** Values parsed from the email. Which keys are present depends on the category. */
export interface ExtractedValues {
  txnDate?: Date;
  amount?: number;
  direction?: 'debit' | 'credit';
  description?: string;
  category?: string;
  statementDate?: Date;
  dueDate?: Date;
  totalDue?: number;
  minDue?: number;
  expiryMonth?: number;
  expiryYear?: number;
  statementDay?: number;
  dueDay?: number;
}

export interface ReviewEmailMeta {
  account: string; // which connected Gmail address
  from: string;
  subject: string;
  receivedAt: Date | null;
  messageId: string;
  snippet: string; // short excerpt only, never the full body
}

export interface ReviewItem {
  id: string;
  userId: string;
  kind: ReviewKind;
  category: EmailCategory | null;
  origin: ReviewOrigin;
  connectionId: string | null;
  cardId: string | null; // null when the parser couldn't match a card
  cardHint: { bankName: string; lastFourDigits: string };
  accountHint: string;
  extracted: ExtractedValues;
  confidence: number; // 0–1 from the parser
  email: ReviewEmailMeta;
  status: ReviewStatus;
  createdAt: Date | null;
  resolvedAt: Date | null;
  resolvedValues: ExtractedValues | null;
  edited: boolean;
  targetId: string | null;
}

/** Category options per destination (expenses keep the existing Overview categories). */
export const EXPENSE_CATEGORIES = ['Food', 'Shopping', 'Transport', 'Bills', 'Petrol', 'Tickets', 'Lent', 'Others'];
export const INCOME_CATEGORIES = ['Salary', 'Other income', 'Refund', 'Interest', 'Cashback'];
export const BILL_CATEGORIES = ['Bills', 'Card Payment', 'Rent', 'Insurance', 'EMI', 'Others'];

/** Maps a parser/card category onto the destination's category list. */
export function categoryFor(kind: ReviewKind, suggested: string | undefined, txnCategories: readonly string[]): string {
  const s = suggested ?? '';
  const pick = (list: readonly string[], fallback: string, aliases: Record<string, string> = {}) =>
    list.includes(s) ? s : list.includes(aliases[s]) ? aliases[s] : fallback;
  switch (kind) {
    case 'expense':
      return pick(EXPENSE_CATEGORIES, 'Others', { Groceries: 'Food', Travel: 'Transport', Fuel: 'Petrol', Entertainment: 'Tickets', 'Card Payment': 'Bills', EMI: 'Bills' });
    case 'income':
      return pick(INCOME_CATEGORIES, 'Other income');
    case 'bill':
      return pick(BILL_CATEGORIES, 'Bills');
    case 'transaction':
      return pick(txnCategories, 'Others', { Transport: 'Travel', Petrol: 'Fuel', Tickets: 'Entertainment', Salary: 'Others' });
    default:
      return s;
  }
}
