/** gmail_connections/{connId} — one connected Gmail mailbox (created by Cloud Functions). */
export const MONITOR_GROUPS = ['salary', 'bank', 'cards', 'bills', 'payments', 'wallets'] as const;
export type MonitorGroup = (typeof MONITOR_GROUPS)[number];

export const MONITOR_GROUP_INFO: Record<MonitorGroup, { label: string; icon: string; hint: string }> = {
  salary: { label: 'Salary', icon: 'briefcase', hint: 'Salary credits → Income' },
  bank: { label: 'Bank transactions', icon: 'landmark', hint: 'Account credits & debits, UPI/NEFT/IMPS → Income / Expenses' },
  cards: { label: 'Credit cards', icon: 'credit-card', hint: 'Card spends, refunds, statements, due-date changes → Cards' },
  bills: { label: 'Bills & dues', icon: 'receipt', hint: 'Bills generated, payment due reminders → Upcoming payments' },
  payments: { label: 'Payment confirmations', icon: 'circle-check', hint: 'Payments received / successful → Cards or Expenses' },
  wallets: { label: 'Wallets', icon: 'wallet', hint: 'Paytm, Amazon Pay, PhonePe, MobiKwik, FASTag spends, top-ups, refunds & cashback → Wallets' },
};

export type ConnectionStatus = 'active' | 'reauth_required' | 'error';

export interface SyncStats {
  scanned: number;
  matched: number;
  created: number;
  duplicates: number;
  ignored: number;
  skipped: number;
  errors: number;
  complete: boolean;
}

export interface GmailConnection {
  id: string;
  userId: string;
  email: string;
  status: ConnectionStatus;
  paused: boolean;
  groups: MonitorGroup[];
  backfillDays: number;
  createdAt: Date | null;
  lastSyncAt: Date | null;
  lastRunAt: Date | null;
  lastRunStats: SyncStats | null;
  lastError: string | null;
  backfillInProgress: boolean;
}
