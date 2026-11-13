/**
 * Pure analytics for the dashboard, account pages and Review. No Angular / Firebase imports.
 *
 * Every money record (expense, income, card transaction, wallet transaction, transfer) is mapped
 * to one FinanceTxn so totals use ONE definition everywhere:
 *   income  = income entries, EXCLUDING the system carry-forward (that is last month's leftover,
 *             not new money — counting it in a multi-month range would count the same rupee twice)
 *   spent   = budget.util spendValue(): expenses (minus card bills / wallet top-ups / repaid loans)
 *             + card purchases − card refunds + wallet spends − wallet refunds
 *   net     = income − spent
 * Transfers, card bill payments, wallet top-ups and cashback are "moves": shown, never totalled.
 */
import { MoneyItem, spendValue, walletMoneyItem } from './budget.util';
import { AccountRef } from '../models/account.model';
import { addDays, dayKey } from './spending.util';
import { monthKey } from './date-input.util';

export type TxnKind = 'expense' | 'income' | 'card' | 'wallet' | 'transfer';
export type TxnFlow = 'in' | 'out' | 'move';

export interface FinanceTxn {
  key: string;
  id: string;
  kind: TxnKind;
  flow: TxnFlow;
  amount: number;
  /** Contribution to "spent" (negative for refunds, 0 for moves / income). */
  spend: number;
  /** Contribution to "income" (0 for carry-forward and everything that isn't income). */
  income: number;
  date: Date;
  title: string;
  category: string;
  account: AccountRef | null;
  /** Second account for transfers (the destination). */
  account2: AccountRef | null;
  system: boolean;
  carryForward: boolean;
  source: string; // manual | email | demo | system
  note: string;
  raw: any;
}

// ── Mapping ─────────────────────────────────────────────────────
const d0 = (v: unknown): Date => (v instanceof Date ? v : new Date(0));

export function fromExpense(e: any, toDate: (v: unknown) => Date | null): FinanceTxn {
  const amount = Number(e.amount) || 0;
  const item: MoneyItem = { source: 'expense', amount, date: toDate(e.date), category: e.category, status: e.status };
  const spend = spendValue(item);
  return {
    key: `expense:${e.id}`,
    id: e.id,
    kind: 'expense',
    flow: spend > 0 ? 'out' : 'move',
    amount,
    spend,
    income: 0,
    date: d0(item.date),
    title: e.description || e.category || 'Expense',
    category: e.category || 'Others',
    account: e.accountType && e.accountId ? { type: e.accountType, id: e.accountId } : null,
    account2: null,
    system: false,
    carryForward: false,
    source: e.importedFrom ?? 'manual',
    note: e.notes ?? '',
    raw: e,
  };
}

export function fromIncome(i: any, toDate: (v: unknown) => Date | null): FinanceTxn {
  const amount = Number(i.amount) || 0;
  const cf = !!i.isCarryForward;
  return {
    key: `income:${i.id}`,
    id: i.id,
    kind: 'income',
    flow: 'in',
    amount,
    spend: 0,
    income: cf ? 0 : amount,
    date: d0(toDate(i.date)),
    title: i.source || i.description || 'Income',
    category: i.category || (cf ? 'Carry forward' : 'Income'),
    account: i.accountType && i.accountId ? { type: i.accountType, id: i.accountId } : null,
    account2: null,
    system: !!i.isSystemGenerated,
    carryForward: cf,
    source: i.isSystemGenerated ? 'system' : i.importedFrom ?? 'manual',
    note: i.notes ?? i.description ?? '',
    raw: i,
  };
}

export function fromCardTxn(c: any): FinanceTxn {
  const amount = Number(c.amount) || 0;
  const spend = spendValue({ source: 'card', amount, date: c.txnDate, category: c.category, direction: c.direction });
  return {
    key: `card:${c.id}`,
    id: c.id,
    kind: 'card',
    flow: c.direction === 'debit' ? 'out' : spend < 0 ? 'in' : 'move',
    amount,
    spend,
    income: 0,
    date: c.txnDate,
    title: c.description || 'Card transaction',
    category: c.category || (c.direction === 'credit' ? 'Card Payment' : 'Others'),
    account: { type: 'card', id: c.cardId },
    account2: null,
    system: false,
    carryForward: false,
    source: c.source ?? 'manual',
    note: '',
    raw: c,
  };
}

export function fromWalletTxn(t: any): FinanceTxn {
  const amount = Number(t.amount) || 0;
  const spend = spendValue(walletMoneyItem(t));
  const label: Record<string, string> = { topup: 'Top-up', cashback: 'Cashback', refund: 'Refund' };
  return {
    key: `wallet:${t.id}`,
    id: t.id,
    kind: 'wallet',
    flow: t.type === 'spend' ? 'out' : t.type === 'refund' ? 'in' : 'move',
    amount,
    spend,
    income: 0,
    date: t.date,
    title: t.description || label[t.type] || 'Wallet entry',
    category: t.type === 'spend' || t.type === 'refund' ? t.category || 'Others' : label[t.type] ?? t.type,
    account: { type: 'wallet', id: t.walletId },
    account2: null,
    system: false,
    carryForward: false,
    source: t.source ?? 'manual',
    note: '',
    raw: t,
  };
}

export function fromTransfer(t: any): FinanceTxn {
  return {
    key: `transfer:${t.id}`,
    id: t.id,
    kind: 'transfer',
    flow: 'move',
    amount: Number(t.amount) || 0,
    spend: 0,
    income: 0,
    date: t.date,
    title: t.note || 'Transfer',
    category: 'Transfer',
    account: { type: t.fromType, id: t.fromId },
    account2: { type: t.toType, id: t.toId },
    system: false,
    carryForward: false,
    source: 'manual',
    note: t.note ?? '',
    raw: t,
  };
}

/** Does this transaction touch the given account (as source or destination)? */
export function touches(t: FinanceTxn, ref: AccountRef | null): boolean {
  if (!ref) return true;
  const eq = (r: AccountRef | null) => !!r && r.type === ref.type && r.id === ref.id;
  return eq(t.account) || eq(t.account2);
}

/** Signed effect on an account's balance (bank / wallet). */
export function balanceEffect(t: FinanceTxn, ref: AccountRef): number {
  const eq = (r: AccountRef | null) => !!r && r.type === ref.type && r.id === ref.id;
  if (t.kind === 'transfer') return eq(t.account2) ? t.amount : eq(t.account) ? -t.amount : 0;
  if (!eq(t.account)) return 0;
  if (t.kind === 'income') return t.amount;
  if (t.kind === 'expense') return -t.amount;
  if (t.kind === 'wallet') return t.raw?.type === 'spend' ? -t.amount : t.amount;
  return 0;
}

// ── Date ranges ─────────────────────────────────────────────────
export type RangePreset = 'today' | 'week' | 'month' | 'prev-month' | '3m' | '6m' | 'year' | 'custom';
export interface DateRange {
  preset: RangePreset;
  start: Date; // inclusive, local midnight
  end: Date; // exclusive, local midnight
  label: string;
}

export const RANGE_PRESETS: { id: RangePreset; label: string; short: string }[] = [
  { id: 'today', label: 'Today', short: 'Today' },
  { id: 'week', label: 'This week', short: 'Week' },
  { id: 'month', label: 'This month', short: 'Month' },
  { id: 'prev-month', label: 'Previous month', short: 'Prev' },
  { id: '3m', label: 'Last 3 months', short: '3M' },
  { id: '6m', label: 'Last 6 months', short: '6M' },
  { id: 'year', label: 'This year', short: 'Year' },
  { id: 'custom', label: 'Custom range', short: 'Custom' },
];

const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fmtD = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Longest custom range allowed (keeps Firestore reads bounded). */
export const MAX_RANGE_MONTHS = 24;

export function rangeFor(preset: RangePreset, today = new Date(), custom?: { start: Date; end: Date }): DateRange {
  const t = sod(today);
  const y = t.getFullYear();
  const m = t.getMonth();
  switch (preset) {
    case 'today':
      return { preset, start: t, end: addDays(t, 1), label: 'Today' };
    case 'week': {
      const dow = (t.getDay() + 6) % 7; // Monday = 0
      return { preset, start: addDays(t, -dow), end: addDays(t, 1), label: 'This week' };
    }
    case 'prev-month': {
      const s = new Date(y, m - 1, 1);
      return { preset, start: s, end: new Date(y, m, 1), label: s.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
    }
    case '3m':
      return { preset, start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 1), label: 'Last 3 months' };
    case '6m':
      return { preset, start: new Date(y, m - 5, 1), end: new Date(y, m + 1, 1), label: 'Last 6 months' };
    case 'year':
      return { preset, start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: String(y) };
    case 'custom': {
      let s = sod(custom?.start ?? new Date(y, m, 1));
      let e = sod(custom?.end ?? t);
      if (e < s) [s, e] = [e, s];
      const earliest = new Date(e.getFullYear(), e.getMonth() - MAX_RANGE_MONTHS + 1, 1);
      if (s < earliest) s = earliest;
      return { preset, start: s, end: addDays(e, 1), label: `${fmtD(s)} – ${fmtD(e)}` };
    }
    case 'month':
    default:
      return { preset: 'month', start: new Date(y, m, 1), end: new Date(y, m + 1, 1), label: t.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
  }
}

/** 'YYYY-MM' keys covering [start, end). */
export function monthsIn(start: Date, end: Date): string[] {
  const out: string[] = [];
  let c = new Date(start.getFullYear(), start.getMonth(), 1);
  while (c < end) {
    out.push(monthKey(c));
    c = new Date(c.getFullYear(), c.getMonth() + 1, 1);
  }
  return out;
}

export const inRange = (t: FinanceTxn, r: { start: Date; end: Date }) => t.date >= r.start && t.date < r.end;

/** Days of the range that have already happened (for averages). Minimum 1. */
export function elapsedDays(r: { start: Date; end: Date }, today = new Date()): number {
  const end = r.end < addDays(sod(today), 1) ? r.end : addDays(sod(today), 1);
  return Math.max(1, Math.round((end.getTime() - r.start.getTime()) / 86_400_000));
}

// ── Aggregations ────────────────────────────────────────────────
export interface Totals {
  income: number;
  spent: number;
  net: number;
  count: number;
  refunds: number;
  moves: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function totals(list: FinanceTxn[]): Totals {
  let income = 0, spent = 0, refunds = 0, moves = 0;
  for (const t of list) {
    income += t.income;
    spent += t.spend;
    if (t.spend < 0) refunds += -t.spend;
    if (t.flow === 'move') moves += t.amount;
  }
  return { income: r2(income), spent: r2(spent), net: r2(income - spent), count: list.length, refunds: r2(refunds), moves: r2(moves) };
}

export interface CategorySlice {
  name: string;
  amount: number;
  pct: number;
  icon: string;
  color: string;
}

export function byCategory(list: FinanceTxn[], mode: 'spend' | 'income' = 'spend'): CategorySlice[] {
  const m = new Map<string, number>();
  for (const t of list) {
    const v = mode === 'spend' ? t.spend : t.income;
    if (v <= 0) continue;
    const name = t.category || 'Others';
    m.set(name, (m.get(name) ?? 0) + v);
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount], i) => ({
      name,
      amount: r2(amount),
      pct: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
      icon: categoryIcon(name),
      color: `var(--c${(i % 8) + 1})`,
    }));
}

export interface Series {
  keys: string[];
  labels: string[];
  income: number[];
  spent: number[];
  net: number[];
}

export function monthlySeries(list: FinanceTxn[], months: string[]): Series {
  const idx = new Map(months.map((k, i) => [k, i]));
  const income = new Array(months.length).fill(0);
  const spent = new Array(months.length).fill(0);
  for (const t of list) {
    const i = idx.get(monthKey(t.date));
    if (i === undefined) continue;
    income[i] += t.income;
    spent[i] += t.spend;
  }
  return {
    keys: months,
    labels: months.map(k => {
      const [y, m] = k.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: months.length > 12 || new Date().getFullYear() !== y ? '2-digit' : undefined });
    }),
    income: income.map(r2),
    spent: spent.map(r2),
    net: income.map((v, i) => r2(v - spent[i])),
  };
}

/** Per-day series for [start, end) — used when the range is a month or shorter. */
export function dailySeries(list: FinanceTxn[], r: { start: Date; end: Date }): Series {
  const keys: string[] = [];
  for (let d = r.start; d < r.end; d = addDays(d, 1)) keys.push(dayKey(d));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const income = new Array(keys.length).fill(0);
  const spent = new Array(keys.length).fill(0);
  for (const t of list) {
    const i = idx.get(dayKey(t.date));
    if (i === undefined) continue;
    income[i] += t.income;
    spent[i] += t.spend;
  }
  return {
    keys,
    labels: keys.map(k => {
      const [y, m, d] = k.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }),
    income: income.map(r2),
    spent: spent.map(r2),
    net: income.map((v, i) => r2(v - spent[i])),
  };
}

// ── Daily spending insight ──────────────────────────────────────
export interface DailyInsight {
  today: number;
  average: number; // over elapsed days of the range
  days: number;
  highest: { date: Date; amount: number } | null;
  lowest: { date: Date; amount: number } | null; // lowest day that had spending
  noSpendDays: number;
  last7Average: number;
  message: string;
  tone: 'pos' | 'neutral' | 'warn';
}

export function dailyInsight(list: FinanceTxn[], r: { start: Date; end: Date }, today = new Date()): DailyInsight {
  const t0 = sod(today);
  const stop = r.end < addDays(t0, 1) ? r.end : addDays(t0, 1);
  const byDay = new Map<string, number>();
  for (const t of list) if (t.date >= r.start && t.date < stop) byDay.set(dayKey(t.date), (byDay.get(dayKey(t.date)) ?? 0) + t.spend);

  let highest: DailyInsight['highest'] = null;
  let lowest: DailyInsight['lowest'] = null;
  let noSpend = 0;
  let days = 0;
  let sum = 0;
  for (let d = r.start; d < stop; d = addDays(d, 1)) {
    days++;
    const v = r2(byDay.get(dayKey(d)) ?? 0);
    sum += v;
    if (v <= 0) noSpend++;
    if (v > 0 && (!highest || v > highest.amount)) highest = { date: d, amount: v };
    if (v > 0 && (!lowest || v < lowest.amount)) lowest = { date: d, amount: v };
  }
  days = Math.max(1, days);
  const average = r2(sum / days);

  // Last 7 completed days + today, independent of the selected range.
  let s7 = 0;
  const all = new Map<string, number>();
  for (const t of list) all.set(dayKey(t.date), (all.get(dayKey(t.date)) ?? 0) + t.spend);
  for (let i = 0; i < 7; i++) s7 += all.get(dayKey(addDays(t0, -i))) ?? 0;
  const last7Average = r2(s7 / 7);
  const todaySpend = r2(all.get(dayKey(t0)) ?? 0);

  let message = `Your average daily spending is ${inr(average)}.`;
  let tone: DailyInsight['tone'] = 'neutral';
  const todayInRange = t0 >= r.start && t0 < r.end;
  if (todayInRange && average > 0) {
    if (todaySpend === 0) { message = `No spending recorded today. Your daily average is ${inr(average)}.`; tone = 'pos'; }
    else if (todaySpend < average) { message = `You spent less today than your daily average of ${inr(average)}.`; tone = 'pos'; }
    else if (todaySpend > average * 1.5) { message = `Today is above your daily average of ${inr(average)}.`; tone = 'warn'; }
  }
  return { today: todaySpend, average, days, highest, lowest, noSpendDays: noSpend, last7Average, message, tone };
}

// ── Habits (only from real activity) ────────────────────────────
export interface Habits {
  /** Consecutive days, ending today (or yesterday if nothing yet today), with at least one entry logged. */
  loggingStreak: number;
  loggedToday: boolean;
  /** Months (of the last 12) with any entry. */
  monthsTracked: number;
  /** Consecutive completed months, newest first, where income ≥ spending (only months with income). */
  positiveMonths: number;
  /** Last 35 days: activity per day for the calendar (oldest first). */
  calendar: { date: Date; count: number; spend: number }[];
}

export function habits(list: FinanceTxn[], monthly: Series | null, today = new Date()): Habits {
  const t0 = sod(today);
  const counts = new Map<string, { count: number; spend: number }>();
  for (const t of list) {
    if (t.system) continue;
    const k = dayKey(t.date);
    const c = counts.get(k) ?? { count: 0, spend: 0 };
    c.count++;
    c.spend += Math.max(0, t.spend);
    counts.set(k, c);
  }
  const loggedToday = counts.has(dayKey(t0));
  let streak = 0;
  for (let i = loggedToday ? 0 : 1; i < 400; i++) {
    if (!counts.has(dayKey(addDays(t0, -i)))) break;
    streak++;
  }
  const months = new Set([...counts.keys()].map(k => k.slice(0, 7)));
  const calendar = [];
  for (let i = 34; i >= 0; i--) {
    const d = addDays(t0, -i);
    const c = counts.get(dayKey(d));
    calendar.push({ date: d, count: c?.count ?? 0, spend: r2(c?.spend ?? 0) });
  }
  let positive = 0;
  if (monthly) {
    const current = monthKey(t0);
    for (let i = monthly.keys.length - 1; i >= 0; i--) {
      if (monthly.keys[i] === current) continue; // month not finished
      if (monthly.income[i] <= 0) break;
      if (monthly.net[i] < 0) break;
      positive++;
    }
  }
  return { loggingStreak: streak, loggedToday, monthsTracked: months.size, positiveMonths: positive, calendar };
}

// ── Presentation helpers ────────────────────────────────────────
export function inr(n: number, decimals = false): string {
  const v = Number(n) || 0;
  return (v < 0 ? '−' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: decimals ? 2 : 0, minimumFractionDigits: 0 });
}

const CATEGORY_ICONS: Record<string, string> = {
  food: 'utensils', groceries: 'shopping-cart', shopping: 'shopping-bag', transport: 'car', travel: 'plane',
  petrol: 'fuel', fuel: 'fuel', bills: 'lightbulb', tickets: 'ticket', entertainment: 'film', health: 'heart-pulse',
  education: 'graduation-cap', emi: 'building2', rent: 'home', insurance: 'shield-check', recharge: 'smartphone',
  lent: 'handshake', 'card bill': 'credit-card', 'card payment': 'credit-card', 'wallet top-up': 'wallet',
  'top-up': 'wallet', cashback: 'gift', refund: 'undo2', salary: 'briefcase', interest: 'percent',
  'other income': 'coins', income: 'coins', 'carry forward': 'history', transfer: 'arrow-left-right',
};
export function categoryIcon(name: string | null | undefined): string {
  return CATEGORY_ICONS[(name ?? '').toLowerCase()] ?? 'tag';
}
