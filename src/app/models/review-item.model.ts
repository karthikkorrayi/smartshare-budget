/**
 * review_items/{reviewId}
 *
 * Created by the Gmail sync Cloud Function (origin 'gmail', Phase C) or by the
 * "Load sample" button (origin 'demo'). Nothing extracted from email becomes
 * verified data until the user approves it; Firestore rules enforce that the
 * target record and the review approval are written in the same batch.
 */
export const REVIEW_KINDS = ['transaction', 'statement', 'card_update'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export type ReviewOrigin = 'gmail' | 'demo';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** Values parsed from the email. Which keys are present depends on `kind`. */
export interface ExtractedValues {
  // transaction
  txnDate?: Date;
  amount?: number;
  direction?: 'debit' | 'credit';
  description?: string;
  category?: string;
  // statement
  statementDate?: Date;
  dueDate?: Date;
  totalDue?: number;
  minDue?: number;
  // card_update
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
  origin: ReviewOrigin;
  cardId: string | null; // null when the parser couldn't match a card
  cardHint: { bankName: string; lastFourDigits: string };
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

export const REVIEW_KIND_LABELS: Record<ReviewKind, string> = {
  transaction: 'Transaction',
  statement: 'Statement',
  card_update: 'Card details change',
};
