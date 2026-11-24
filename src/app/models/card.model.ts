import { dayInMonth, daysBetween, nextDayOfMonth, startOfDay } from '../utils/date-input.util';

/**
 * cards/{cardId}
 * Only the last four digits are ever stored. Never full card numbers, CVV or PIN.
 * `statementDay` / `dueDay` are the recurring billing cycle (day of month);
 * actual per-cycle dates and amounts live in card_statements.
 *
 * Everything below "Phase 2" is optional: cards saved before it keep working, and every number
 * that depends on a missing field (available limit, interest, rewards…) simply isn't shown.
 */
export const CARD_STATUSES = ['Active', 'Closed'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** 'review' = last change came from an approved email review item. */
export type CardUpdateSource = 'manual' | 'review';

export const CARD_NETWORKS = ['visa', 'mastercard', 'rupay', 'amex', 'diners', 'other'] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number];
export const NETWORK_LABEL: Record<CardNetwork, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  rupay: 'RuPay',
  amex: 'American Express',
  diners: 'Diners Club',
  other: 'Other',
};

export const CARD_TIERS = ['classic', 'gold', 'platinum', 'signature', 'infinite', 'select', 'business', 'other'] as const;
export type CardTier = (typeof CARD_TIERS)[number];
export const TIER_LABEL: Record<CardTier, string> = {
  classic: 'Classic',
  gold: 'Gold',
  platinum: 'Platinum',
  signature: 'Signature / World',
  infinite: 'Infinite / World Elite',
  select: 'Select / Premium',
  business: 'Business / Corporate',
  other: 'Other',
};

/** Card face colours (gradients follow the light/dark theme via CSS variables in _tokens.scss). */
export const CARD_ARTS = ['indigo', 'teal', 'midnight', 'rose', 'amber', 'graphite'] as const;
export type CardArt = (typeof CARD_ARTS)[number];

export const REWARD_TYPES = ['points', 'cashback', 'miles', 'none'] as const;
export type RewardType = (typeof REWARD_TYPES)[number];
export const REWARD_LABEL: Record<RewardType, { label: string; unit: string; icon: string }> = {
  points: { label: 'Reward points', unit: 'points', icon: 'star' },
  cashback: { label: 'Cashback', unit: '%', icon: 'coins' },
  miles: { label: 'Air miles', unit: 'miles', icon: 'plane' },
  none: { label: 'No rewards', unit: '', icon: 'circle-x' },
};

export const AUTOPAY_MODES = ['none', 'minimum', 'full'] as const;
export type AutopayMode = (typeof AUTOPAY_MODES)[number];
export const AUTOPAY_LABEL: Record<AutopayMode, string> = { none: 'Not set up', minimum: 'Minimum due', full: 'Total due' };

/** Common benefits offered as tags (users can add their own too). */
export const CARD_BENEFITS: { id: string; label: string; icon: string }[] = [
  { id: 'lounge', label: 'Airport lounge', icon: 'plane' },
  { id: 'fuel', label: 'Fuel surcharge waiver', icon: 'fuel' },
  { id: 'dining', label: 'Dining offers', icon: 'utensils' },
  { id: 'movies', label: 'Movie offers', icon: 'film' },
  { id: 'shopping', label: 'Shopping cashback', icon: 'shopping-bag' },
  { id: 'travel', label: 'Travel insurance', icon: 'shield-check' },
  { id: 'emi', label: 'EMI conversion', icon: 'repeat' },
  { id: 'forex', label: 'Low forex markup', icon: 'coins' },
  { id: 'contactless', label: 'Contactless / tap to pay', icon: 'zap' },
  { id: 'milestone', label: 'Milestone rewards', icon: 'trophy' },
  { id: 'welcome', label: 'Welcome benefit', icon: 'gift' },
  { id: 'upi', label: 'UPI on credit card', icon: 'smartphone' },
];

export interface Card {
  id: string;
  userId: string;
  cardholderName: string;
  bankName: string;
  /** Shown as "Card name" (e.g. Millennia, Regalia). */
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

  // ── Phase 2 (all optional) ─────────────────────────────────────
  network: CardNetwork | null;
  tier: CardTier | null;
  art: CardArt;
  /** Total credit limit (0 = not set). */
  creditLimit: number;
  /** Cash withdrawal limit (0 = not set). */
  cashLimit: number;
  /** What was owed on the card on `openingAsOf` (for a card added mid-cycle). Used until a statement is recorded. */
  openingOutstanding: number;
  openingAsOf: Date | null;
  /** Interest on carried-over balance, % per month (Indian cards quote ~3–3.75% p.m.). 0 = not set. */
  interestMonthly: number;
  annualFee: number;
  /** Yearly spend that waives the annual fee (0 = no waiver). */
  feeWaiverSpend: number;
  lateFee: number;
  cashAdvanceFeePct: number;
  forexMarkupPct: number;
  rewardType: RewardType;
  /** Points/miles earned per ₹100 spent, or cashback %. */
  rewardRate: number;
  /** Current points/miles balance (as on rewardsAsOf). */
  rewardBalance: number;
  /** ₹ value of one point/mile when redeemed. */
  rewardValue: number;
  rewardsAsOf: Date | null;
  benefits: string[];
  notes: string;
  autopay: AutopayMode;
  /** Warn when usage crosses this % of the limit (0 = off). */
  utilAlertPct: number;
}

/** Everything the add/edit form saves. */
export type CardInput = Omit<Card, 'id' | 'userId' | 'createdAt' | 'lastUpdated' | 'lastUpdateSource'>;

/** Defaults for the optional Phase 2 fields (used for new cards and for reading older documents). */
export const CARD_DEFAULTS: Omit<CardInput, 'cardholderName' | 'bankName' | 'nickname' | 'lastFourDigits' | 'expiryMonth' | 'expiryYear' | 'statementDay' | 'dueDay' | 'status' | 'dailySpendingLimit'> = {
  network: null,
  tier: null,
  art: 'indigo',
  creditLimit: 0,
  cashLimit: 0,
  openingOutstanding: 0,
  openingAsOf: null,
  interestMonthly: 0,
  annualFee: 0,
  feeWaiverSpend: 0,
  lateFee: 0,
  cashAdvanceFeePct: 0,
  forexMarkupPct: 0,
  rewardType: 'none',
  rewardRate: 0,
  rewardBalance: 0,
  rewardValue: 0,
  rewardsAsOf: null,
  benefits: [],
  notes: '',
  autopay: 'none',
  utilAlertPct: 0,
};

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

export function benefitLabel(id: string): { label: string; icon: string } {
  const b = CARD_BENEFITS.find(x => x.id === id);
  return b ? { label: b.label, icon: b.icon } : { label: id, icon: 'tag' };
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

/** Payment due date for a statement generated on `statement`: the next `dueDay` after it. */
export function dueAfterStatement(statement: Date, dueDay: number): Date {
  const same = dayInMonth(statement.getFullYear(), statement.getMonth(), dueDay);
  return same > statement ? same : dayInMonth(statement.getFullYear(), statement.getMonth() + 1, dueDay);
}

/**
 * The billing cycle around `today`:
 *  - cycleStart: the day after the previous statement day (a purchase ON a statement day lands on that
 *    day's statement, so the new cycle starts the next day);
 *  - nextStatement: the statement that today's purchases will appear on;
 *  - nextDue: when that statement must be paid;
 *  - freeDays: interest-free days for a purchase made today (today → nextDue).
 */
export function billingCycle(c: Pick<Card, 'statementDay' | 'dueDay'>, today = new Date()) {
  const t = startOfDay(today);
  const thisMonth = dayInMonth(t.getFullYear(), t.getMonth(), c.statementDay);
  const nextStatement = thisMonth >= t ? thisMonth : dayInMonth(t.getFullYear(), t.getMonth() + 1, c.statementDay);
  const lastStatement = dayInMonth(nextStatement.getFullYear(), nextStatement.getMonth() - 1, c.statementDay);
  const cycleStart = new Date(lastStatement.getFullYear(), lastStatement.getMonth(), lastStatement.getDate() + 1);
  const nextDue = dueAfterStatement(nextStatement, c.dueDay);
  const lastDue = dueAfterStatement(lastStatement, c.dueDay);
  const cycleDays = daysBetween(cycleStart, nextStatement) + 1;
  const elapsed = Math.min(cycleDays, Math.max(0, daysBetween(cycleStart, t) + 1));
  return {
    cycleStart,
    lastStatement,
    lastDue,
    nextStatement,
    nextDue,
    daysToStatement: daysBetween(t, nextStatement),
    freeDays: daysBetween(t, nextDue),
    /** Longest possible interest-free period (purchase on the cycle's first day). */
    maxFreeDays: daysBetween(cycleStart, nextDue),
    cycleProgress: Math.round((elapsed / cycleDays) * 100),
  };
}

/** Minimal statement / transaction shapes the maths needs (keeps this file free of service imports). */
export interface StatementLite {
  cardId: string;
  statementDate: Date;
  dueDate: Date;
  totalDue: number;
  minDue: number;
  paidAmount: number;
  status: string;
}
export interface CardTxnLite {
  cardId: string;
  txnDate: Date;
  amount: number;
  direction: 'debit' | 'credit';
  category: string;
}

export interface CardPosition {
  cardId: string;
  /** Unpaid amounts on recorded statements (or the opening outstanding before the first statement). */
  billed: number;
  /** Spends − refunds since the last statement (not billed yet). */
  unbilled: number;
  /** What you owe right now = billed + unbilled (never below 0). */
  used: number;
  limit: number;
  /** limit − used (can be negative = over limit). null when no limit is set. */
  available: number | null;
  /** used ÷ limit, 0–100+ (null when no limit). */
  usedPct: number | null;
  overLimit: boolean;
  /** Spends − refunds in the current billing cycle. */
  cycleSpend: number;
  /** Spends − refunds in the last 365 days (for the annual-fee waiver). */
  yearSpend: number;
  /** Latest recorded statement, if any. */
  lastStatement: StatementLite | null;
  /** Unpaid minimum due across unpaid statements. */
  minDue: number;
  /** Interest for one month if only the minimum is paid: (billed − minDue) × monthly rate. null when no rate. */
  interestIfMinimum: number | null;
  /** Annual-fee waiver progress 0–100 (null when no waiver threshold). */
  waiverPct: number | null;
  /** ₹ value of the reward balance (null when unknown). */
  rewardsWorth: number | null;
  /** Points/miles (or ₹ cashback) earned on this cycle's spends at the card's rate. */
  rewardsThisCycle: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const isRefund = (t: CardTxnLite) => t.direction === 'credit' && t.category === 'Refund';

/**
 * One card's position. Rules (so nothing is counted twice):
 *  - With a recorded statement: billed = unpaid statements (totalDue − paidAmount);
 *    unbilled = debits − refunds dated AFTER the latest statement date. Bill payments are
 *    tracked on the statements ("Mark paid"), so payment credits don't reduce unbilled.
 *  - Before the first statement: billed = opening outstanding (as of openingAsOf);
 *    unbilled = debits − every credit (refunds AND payments) since openingAsOf.
 */
export function cardPosition(
  c: Card,
  statements: StatementLite[],
  txns: CardTxnLite[],
  today = new Date()
): CardPosition {
  const mine = statements.filter(s => s.cardId === c.id).sort((a, b) => b.statementDate.getTime() - a.statementDate.getTime());
  const tx = txns.filter(t => t.cardId === c.id);
  const latest = mine[0] ?? null;
  const useStatements = !!latest && (!c.openingAsOf || latest.statementDate >= startOfDay(c.openingAsOf));

  let billed: number;
  let unbilled: number;
  if (useStatements) {
    billed = mine.filter(s => s.status !== 'Paid').reduce((s, x) => s + Math.max(0, x.totalDue - x.paidAmount), 0);
    const after = startOfDay(latest!.statementDate).getTime() + 86_400_000; // strictly after the statement day
    unbilled = tx.filter(t => t.txnDate.getTime() >= after).reduce((s, t) => s + (t.direction === 'debit' ? t.amount : isRefund(t) ? -t.amount : 0), 0);
  } else {
    billed = Math.max(0, c.openingOutstanding || 0);
    const from = c.openingAsOf ? startOfDay(c.openingAsOf).getTime() : -Infinity;
    unbilled = tx.filter(t => t.txnDate.getTime() >= from).reduce((s, t) => s + (t.direction === 'debit' ? t.amount : -t.amount), 0);
  }
  const used = r2(Math.max(0, billed + unbilled));
  const limit = Math.max(0, c.creditLimit || 0);
  const available = limit > 0 ? r2(limit - used) : null;
  const usedPct = limit > 0 ? Math.round((used / limit) * 100) : null;

  const cyc = billingCycle(c, today);
  const net = (from: Date) =>
    tx.filter(t => t.txnDate >= from && t.txnDate <= today).reduce((s, t) => s + (t.direction === 'debit' ? t.amount : isRefund(t) ? -t.amount : 0), 0);
  const cycleSpend = r2(Math.max(0, net(cyc.cycleStart)));
  const yearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const yearSpend = r2(Math.max(0, net(yearAgo)));

  const unpaid = mine.filter(s => s.status !== 'Paid');
  const minDue = r2(unpaid.reduce((s, x) => s + Math.max(0, Math.min(x.minDue, x.totalDue - x.paidAmount)), 0));
  const carried = Math.max(0, (useStatements ? billed : 0) - minDue);
  const interestIfMinimum = c.interestMonthly > 0 && useStatements ? r2((carried * c.interestMonthly) / 100) : null;

  const rate = c.rewardRate || 0;
  const rewardsThisCycle =
    c.rewardType === 'none' || rate <= 0 ? null : c.rewardType === 'cashback' ? r2((cycleSpend * rate) / 100) : Math.floor((cycleSpend / 100) * rate);
  const rewardsWorth =
    c.rewardType === 'none' ? null : c.rewardType === 'cashback' ? null : c.rewardValue > 0 ? r2(c.rewardBalance * c.rewardValue) : null;

  return {
    cardId: c.id,
    billed: r2(billed),
    unbilled: r2(unbilled),
    used,
    limit,
    available,
    usedPct,
    overLimit: limit > 0 && used > limit,
    cycleSpend,
    yearSpend,
    lastStatement: latest,
    minDue,
    interestIfMinimum,
    waiverPct: c.feeWaiverSpend > 0 ? Math.min(100, Math.round((yearSpend / c.feeWaiverSpend) * 100)) : null,
    rewardsWorth,
    rewardsThisCycle,
  };
}

/** Earliest transaction date the positions need (so one range query covers every card). */
export function positionWindowStart(cards: Card[], statements: StatementLite[], today = new Date()): Date {
  let start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() - 1); // a year back for the fee waiver
  for (const c of cards) {
    const latest = statements.filter(s => s.cardId === c.id).sort((a, b) => b.statementDate.getTime() - a.statementDate.getTime())[0];
    const anchor = latest && (!c.openingAsOf || latest.statementDate >= c.openingAsOf) ? latest.statementDate : c.openingAsOf ?? c.createdAt;
    if (anchor && anchor < start) start = startOfDay(anchor);
  }
  return start;
}

/** Usage tone for meters and badges: ≤30% healthy, ≤70% watch, above that high. */
export function usageTone(pct: number | null): 'pos' | 'warn' | 'neg' | '' {
  if (pct === null) return '';
  return pct <= 30 ? 'pos' : pct <= 70 ? 'warn' : 'neg';
}
