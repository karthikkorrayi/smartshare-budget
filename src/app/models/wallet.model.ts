/**
 * wallets/{walletId} — money you hold outside a bank account or card: cash, UPI wallets
 * (Paytm, Amazon Pay, PhonePe…), prepaid / meal / gift cards, FASTag.
 *
 * wallet_transactions/{txnId}
 *   spend    — paid from the wallet          → counts in the budget (like a card purchase)
 *   refund   — money back for a spend        → reduces spending
 *   topup    — added from bank / cash / card → NOT spending (it only moves money)
 *   cashback — reward credited to the wallet → NOT income, only raises the balance
 *
 * The balance is never stored: opening balance + top-ups + refunds + cashback − spends.
 */
export const WALLET_KINDS = ['cash', 'upi', 'prepaid', 'other'] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

export const WALLET_KIND_INFO: Record<WalletKind, { icon: string; label: string; hint: string }> = {
  cash: { icon: 'banknote', label: 'Cash', hint: 'Money in your purse or at home' },
  upi: { icon: 'smartphone', label: 'UPI / app wallet', hint: 'Paytm, Amazon Pay, PhonePe, MobiKwik…' },
  prepaid: { icon: 'ticket', label: 'Prepaid card', hint: 'Meal, gift, FASTag or forex card' },
  other: { icon: 'wallet', label: 'Other', hint: 'Anything else that holds a balance' },
};

export const WALLET_PROVIDERS = ['Paytm', 'Amazon Pay', 'PhonePe', 'MobiKwik', 'Google Pay', 'Pluxee (Sodexo)', 'FASTag'] as const;

export const WALLET_TXN_TYPES = ['spend', 'topup', 'refund', 'cashback'] as const;
export type WalletTxnType = (typeof WALLET_TXN_TYPES)[number];

export const WALLET_TXN_INFO: Record<WalletTxnType, { label: string; sign: 1 | -1; counts: string }> = {
  spend: { label: 'Spend', sign: -1, counts: 'Counts in your budget' },
  topup: { label: 'Top-up', sign: 1, counts: "Not spending — it only moves money into the wallet" },
  refund: { label: 'Refund', sign: 1, counts: 'Reduces your spending' },
  cashback: { label: 'Cashback', sign: 1, counts: 'Raises the balance; not counted as income' },
};

export const WALLET_CATEGORIES = [
  'Food', 'Groceries', 'Shopping', 'Travel', 'Fuel', 'Bills', 'Recharge', 'Entertainment', 'Health', 'Others',
] as const;

export interface Wallet {
  id: string;
  userId: string;
  name: string;
  kind: WalletKind;
  provider: string;
  openingBalance: number;
  /** Warn when the balance drops below this (0 = no warning). */
  lowBalanceAlert: number;
  status: 'Active' | 'Closed';
  createdAt: Date | null;
  lastUpdated: Date | null;
}

export type WalletInput = Pick<Wallet, 'name' | 'kind' | 'provider' | 'openingBalance' | 'lowBalanceAlert' | 'status'>;

export interface WalletTransaction {
  id: string;
  userId: string;
  walletId: string;
  type: WalletTxnType;
  amount: number;
  date: Date;
  description: string;
  category: string;
  /** 'manual' (typed in the app) or 'email' / 'demo' (approved in the Review Center, with its reviewId). */
  source: 'manual' | 'email' | 'demo';
  reviewId: string | null;
  createdAt: Date | null;
  lastUpdated: Date | null;
}

export type WalletTxnInput = Pick<WalletTransaction, 'walletId' | 'type' | 'amount' | 'date' | 'description' | 'category'>;

export function walletLabel(w: Pick<Wallet, 'name' | 'kind'>): string {
  return w.name;
}

/** Signed effect of one transaction on the wallet's balance. */
export function balanceEffect(t: Pick<WalletTransaction, 'type' | 'amount'>): number {
  return (WALLET_TXN_INFO[t.type]?.sign ?? 0) * (Number(t.amount) || 0);
}

/** Current balance: opening + every transaction of this wallet. Can go negative (e.g. an IOU in cash). */
export function walletBalance(w: Pick<Wallet, 'id' | 'openingBalance'>, txns: WalletTransaction[]): number {
  const total = txns.filter(t => t.walletId === w.id).reduce((s, t) => s + balanceEffect(t), Number(w.openingBalance) || 0);
  return Math.round(total * 100) / 100;
}

export function isLowBalance(w: Wallet, balance: number): boolean {
  return w.status === 'Active' && w.lowBalanceAlert > 0 && balance < w.lowBalanceAlert;
}
