/**
 * Month budget summary for Overview — pure, unit-checked.
 *
 * Spending = expenses (except "Card Bill" / "Wallet Top-up" payments and old repaid "Lent" entries
 *            with status PAID)
 *          + card purchases − card refunds
 *          + wallet spends − wallet refunds.
 * Card bills and wallet top-ups are excluded because what you buy with that card or wallet is already
 * counted; counting the bill or the top-up too would count the same money twice.
 */

export const CARD_BILL_CATEGORY = 'Card Bill';
export const WALLET_TOPUP_CATEGORY = 'Wallet Top-up';
const MOVES_MONEY = [CARD_BILL_CATEGORY, WALLET_TOPUP_CATEGORY];

export interface MoneyItem {
  amount: number;
  date: Date | null;
  category?: string;
  status?: string;
  direction?: 'debit' | 'credit';
  source: 'expense' | 'card' | 'wallet';
}

export interface BudgetSummary {
  income: number;
  spent: number; // expenses + card net + wallet net
  expenseSpend: number;
  cardSpend: number; // card purchases − refunds
  walletSpend: number; // wallet spends − refunds
  cardBillsPaid: number; // card bills + wallet top-ups logged as expenses: excluded, shown for transparency
  balance: number; // income − spent
  usedPercent: number; // spent / income (0 if no income)
  monthPercent: number; // share of the month elapsed (100 for past months)
  pace: 'under' | 'on' | 'over' | 'no-income';
  daysLeft: number; // including today, current month only
  dailyAverage: number; // spent / days elapsed
  safePerDay: number; // balance spread over the remaining days (current month only)
  projected: number; // month-end spend at the current pace (current month only)
  lastMonthSpent: number;
  vsLastMonth: number; // spent − lastMonthSpent at the same point in the month
  isCurrentMonth: boolean;
  isFuture: boolean;
}

/** Does this item count as spending, and how much (refunds are negative)? */
export function spendValue(i: MoneyItem): number {
  const amt = Number(i.amount) || 0;
  if (amt <= 0) return 0;
  if (i.source === 'expense') {
    if (i.status === 'PAID' || MOVES_MONEY.includes(i.category ?? '')) return 0;
    return amt;
  }
  // Cards and wallets: purchases count, refunds reduce; bill payments, top-ups and cashback don't count.
  if (i.direction === 'credit') return i.category === 'Refund' ? -amt : 0;
  return amt;
}

export function isCardBill(i: MoneyItem): boolean {
  return i.source === 'expense' && MOVES_MONEY.includes(i.category ?? '') && i.status !== 'PAID';
}

/** Daily net spend for a month (index 0 = day 1). */
export function dailySpend(items: MoneyItem[], year: number, monthIndex: number): number[] {
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const out = new Array(days).fill(0);
  for (const i of items) {
    if (!i.date || i.date.getFullYear() !== year || i.date.getMonth() !== monthIndex) continue;
    out[i.date.getDate() - 1] += spendValue(i);
  }
  return out.map(v => Math.round(v * 100) / 100);
}

export function summarizeMonth(
  month: string, // 'YYYY-MM'
  income: number,
  items: MoneyItem[],
  lastMonthItems: MoneyItem[],
  today = new Date()
): BudgetSummary {
  const [y, m] = month.split('-').map(Number);
  const mi = m - 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() === mi;
  const isFuture = new Date(y, mi, 1) > new Date(today.getFullYear(), today.getMonth(), 1);
  const dayOfMonth = isCurrentMonth ? today.getDate() : isFuture ? 0 : daysInMonth;

  const expenseSpend = round(items.filter(i => i.source === 'expense').reduce((s, i) => s + spendValue(i), 0));
  const cardSpend = round(items.filter(i => i.source === 'card').reduce((s, i) => s + spendValue(i), 0));
  const walletSpend = round(items.filter(i => i.source === 'wallet').reduce((s, i) => s + spendValue(i), 0));
  const cardBillsPaid = round(items.filter(isCardBill).reduce((s, i) => s + (Number(i.amount) || 0), 0));
  const spent = round(expenseSpend + cardSpend + walletSpend);
  const balance = round(income - spent);

  const usedPercent = income > 0 ? Math.round((spent / income) * 100) : 0;
  const monthPercent = Math.round((dayOfMonth / daysInMonth) * 100);
  const pace: BudgetSummary['pace'] =
    income <= 0 ? 'no-income' : usedPercent > monthPercent + 10 ? 'over' : usedPercent < monthPercent - 10 ? 'under' : 'on';

  const daysLeft = isCurrentMonth ? daysInMonth - dayOfMonth + 1 : 0;
  const dailyAverage = dayOfMonth > 0 ? round(spent / dayOfMonth) : 0;
  const safePerDay = isCurrentMonth && daysLeft > 0 ? Math.max(0, round(balance / daysLeft)) : 0;
  const projected = isCurrentMonth ? round((spent / Math.max(1, dayOfMonth)) * daysInMonth) : spent;

  // Compare with last month at the SAME day of the month (not its full total).
  const [ly, lm] = [mi === 0 ? y - 1 : y, mi === 0 ? 11 : mi - 1];
  const lastDaily = dailySpend(lastMonthItems, ly, lm);
  const upTo = isCurrentMonth ? Math.min(dayOfMonth, lastDaily.length) : lastDaily.length;
  const lastMonthSpent = round(lastDaily.slice(0, upTo).reduce((s, v) => s + v, 0));

  return {
    income: round(income),
    spent,
    expenseSpend,
    cardSpend,
    walletSpend,
    cardBillsPaid,
    balance,
    usedPercent,
    monthPercent,
    pace,
    daysLeft,
    dailyAverage,
    safePerDay,
    projected,
    lastMonthSpent,
    vsLastMonth: round(spent - lastMonthSpent),
    isCurrentMonth,
    isFuture,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A wallet transaction as a budget item: spend = purchase, refund = refund, top-up / cashback = not spending. */
export function walletMoneyItem(t: { type: string; amount: number; date: Date | null; category?: string }): MoneyItem {
  return {
    source: 'wallet',
    amount: Number(t.amount) || 0,
    date: t.date,
    direction: t.type === 'spend' ? 'debit' : 'credit',
    category: t.type === 'refund' ? 'Refund' : t.type === 'spend' ? t.category || 'Others' : t.type,
  };
}
