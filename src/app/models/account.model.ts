/**
 * Accounts — where money actually sits.
 *
 *  bank_accounts/{id}  NEW. Savings / current / salary accounts with an opening balance.
 *  wallets/{id}        existing (cash, UPI wallets, prepaid).
 *  cards/{id}          existing credit cards — a liability, so never part of "Total wealth".
 *
 * Balances are never stored; they are derived:
 *   bank   = openingBalance + income linked to it − expenses linked to it ± transfers
 *   wallet = existing wallet balance (opening + wallet transactions) + income linked to it ± transfers
 *
 * Expenses / income created before accounts existed carry no account. They still count in the
 * budget (income vs spending) exactly as before, but they don't move any account balance.
 */
export const BANK_KINDS = ['savings', 'current', 'salary', 'other'] as const;
export type BankKind = (typeof BANK_KINDS)[number];
export const BANK_KIND_LABEL: Record<BankKind, string> = {
  savings: 'Savings account',
  current: 'Current account',
  salary: 'Salary account',
  other: 'Other account',
};

export interface BankAccount {
  id: string;
  userId: string;
  name: string; // "HDFC Savings"
  institution: string; // "HDFC Bank"
  kind: BankKind;
  lastFour: string; // optional, '' when not given — never a full account number
  openingBalance: number;
  currency: 'INR';
  status: 'Active' | 'Closed';
  createdAt: Date | null;
  lastUpdated: Date | null;
}

export type BankAccountInput = Pick<BankAccount, 'name' | 'institution' | 'kind' | 'lastFour' | 'openingBalance' | 'status'>;

/** Where an entry's money came from / went to. */
export type AccountType = 'bank' | 'wallet' | 'card';
export interface AccountRef {
  type: AccountType;
  id: string;
}
export const refKey = (r: AccountRef | null | undefined): string => (r ? `${r.type}:${r.id}` : '');
export function parseRef(key: string | null | undefined): AccountRef | null {
  const m = /^(bank|wallet|card):(.+)$/.exec(key ?? '');
  return m ? { type: m[1] as AccountType, id: m[2] } : null;
}

/** transfers/{id} — NEW. Moving your own money between a bank account and a wallet. Never income or spending. */
export interface Transfer {
  id: string;
  userId: string;
  fromType: 'bank' | 'wallet';
  fromId: string;
  toType: 'bank' | 'wallet';
  toId: string;
  amount: number;
  date: Date;
  note: string;
  createdAt: Date | null;
}
export type TransferInput = Pick<Transfer, 'fromType' | 'fromId' | 'toType' | 'toId' | 'amount' | 'date' | 'note'>;

/** One account as the dashboard shows it. */
export interface AccountSummary {
  ref: AccountRef;
  key: string;
  name: string;
  subtitle: string;
  type: AccountType;
  /** For cards: outstanding (amount you owe). For bank / wallet: balance. */
  balance: number;
  /** Cards are liabilities and are excluded from total wealth. */
  inWealth: boolean;
  status: 'Active' | 'Closed';
  icon: string;
  art: 'bank' | 'card' | 'wallet' | 'cash';
  lastActivity: Date | null;
  low?: boolean;
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { bank: 'Bank account', wallet: 'Wallet', card: 'Credit card' };
