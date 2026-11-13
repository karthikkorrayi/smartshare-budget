/**
 * Pure spending maths: day totals, limit crossings, streaks. No Angular/Firebase imports,
 * so it is unit-checked directly. All days are LOCAL calendar days.
 */

export interface SpendEntry {
  date: Date;
  amount: number;
  source: 'expense' | 'card' | 'wallet';
  cardId?: string;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function totalsByDay(entries: SpendEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(dayKey(e.date), (m.get(dayKey(e.date)) ?? 0) + e.amount);
  return m;
}

export function spentOn(entries: SpendEntry[], day: Date, cardId?: string): number {
  const k = dayKey(day);
  return entries
    .filter(e => dayKey(e.date) === k && (cardId === undefined || e.cardId === cardId))
    .reduce((s, e) => s + e.amount, 0);
}

/** True only for the save that pushes the total over the limit (so we warn once, not on every later spend). */
export function crossedLimit(totalAfter: number, amount: number, limit: number): boolean {
  if (!(limit > 0)) return false;
  const before = totalAfter - amount;
  return before <= limit && totalAfter > limit;
}

/**
 * Consecutive days ending YESTERDAY that satisfy `ok(dayTotal)`, never counting before `since`
 * (account creation) — a brand-new user doesn't get a 60-day streak for free.
 * Today is reported separately because it isn't over yet.
 */
function streak(totals: Map<string, number>, today: Date, since: Date, ok: (t: number) => boolean, maxDays: number): number {
  let n = 0;
  const floor = dayKey(since);
  for (let i = 1; i <= maxDays; i++) {
    const d = addDays(today, -i);
    if (dayKey(d) < floor) break;
    if (!ok(totals.get(dayKey(d)) ?? 0)) break;
    n++;
  }
  return n;
}

export interface PulseSummary {
  today: number;
  limit: number; // 0 = none
  remaining: number;
  percent: number; // 0–100+ of limit
  tone: 'ok' | 'warn' | 'over' | 'none';
  noSpendStreak: number; // completed days
  todayNoSpend: boolean;
  withinLimitStreak: number; // completed days (0 when no limit)
  message: { icon: string; text: string } | null;
}

export const MILESTONES = [3, 7, 14, 21, 30, 60];

export function summarize(entries: SpendEntry[], limit: number, today: Date, since: Date, maxDays = 60): PulseSummary {
  const totals = totalsByDay(entries);
  const spent = totals.get(dayKey(today)) ?? 0;
  const noSpend = streak(totals, today, since, t => t <= 0, maxDays);
  const within = limit > 0 ? streak(totals, today, since, t => t <= limit, maxDays) : 0;
  const percent = limit > 0 ? Math.round((spent / limit) * 100) : 0;
  const tone: PulseSummary['tone'] = limit <= 0 ? 'none' : spent > limit ? 'over' : percent >= 80 ? 'warn' : 'ok';
  const todayNoSpend = spent <= 0;

  // One appreciation / nudge line, most meaningful first.
  let message: PulseSummary['message'] = null;
  const runNoSpend = noSpend + (todayNoSpend ? 1 : 0);
  if (tone === 'over') {
    message = { icon: 'alert-triangle', text: `₹${fmt(spent - limit)} over today's limit. Tomorrow is a fresh start.` };
  } else if (MILESTONES.includes(runNoSpend) && todayNoSpend) {
    message = { icon: 'trophy', text: `${runNoSpend} no-spend days in a row — that's a milestone!` };
  } else if (noSpend >= 1 && todayNoSpend) {
    message = { icon: 'sparkles', text: `${runNoSpend} no-spend day${runNoSpend === 1 ? '' : 's'} in a row. Keep it going!` };
  } else if (limit > 0 && within >= 1 && MILESTONES.includes(within)) {
    message = { icon: 'award', text: `Within your daily limit ${within} days running. Brilliant discipline!` };
  } else if (limit > 0 && within >= 2) {
    message = { icon: 'circle-check', text: `Within your daily limit ${within} days in a row.` };
  } else if (todayNoSpend) {
    message = { icon: 'sun', text: 'No spending yet today.' };
  } else if (tone === 'warn') {
    message = { icon: 'info', text: `₹${fmt(limit - spent)} left in today's limit.` };
  }

  return {
    today: spent,
    limit: limit > 0 ? limit : 0,
    remaining: limit > 0 ? Math.max(0, limit - spent) : 0,
    percent,
    tone,
    noSpendStreak: noSpend,
    todayNoSpend,
    withinLimitStreak: within,
    message,
  };
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}
