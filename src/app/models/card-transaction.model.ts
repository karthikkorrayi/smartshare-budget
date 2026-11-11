/**
 * card_transactions/{txnId}
 * source: 'manual' (typed by user) | 'email' (approved Gmail review) | 'demo' (approved sample review)
 * Email/demo transactions always carry the `reviewId` that approved them.
 */
export const TXN_DIRECTIONS = ['debit', 'credit'] as const;
export type TxnDirection = (typeof TXN_DIRECTIONS)[number];
export type TxnSource = 'manual' | 'email' | 'demo';

export const TXN_CATEGORIES = [
  'Food', 'Groceries', 'Shopping', 'Travel', 'Fuel', 'Bills', 'Entertainment',
  'Health', 'Education', 'EMI', 'Card Payment', 'Refund', 'Others',
] as const;

export interface CardTransaction {
  id: string;
  userId: string;
  cardId: string;
  txnDate: Date;
  amount: number;
  direction: TxnDirection; // debit = spend, credit = refund / bill payment
  description: string;
  category: string;
  source: TxnSource;
  reviewId: string | null;
  editedAfterReview: boolean;
  createdAt: Date | null;
  lastUpdated: Date | null;
}

export type TransactionInput = Pick<
  CardTransaction,
  'cardId' | 'txnDate' | 'amount' | 'direction' | 'description' | 'category'
>;
