/**
 * Financial-discipline pushes (pure logic, unit-tested in test/discipline.test.ts).
 * Days are India Standard Time calendar days. The rules mirror the app (src/app/utils/discipline.util.ts):
 *  - spending  = expenses (not card-bill / wallet-top-up payments, not old PAID loans), card purchases
 *                (refunds reduce), wallet spends (refunds reduce)
 *  - logged    = any entry you made that day (expense, income you entered, card / wallet txn, transfer)
 *                or "Nothing spent today" (users/{uid}.checkins)
 *  - streaks   = logging, no-spend, within the daily limit — completed days, never before the account existed
 */
import { istDay } from './reminders';

export const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
const MOVES_MONEY = ['Card Bill', 'Wallet Top-up'];

export interface Day {
  spend: number;
  logged: boolean;
}
/** Keyed by IST day number (istDay). */
export type Days = Map<number, Day>;

export interface RawEntry {
  kind: 'expense' | 'card' | 'wallet' | 'income' | 'transfer';
  date: Date | null;
  amount: number;
  category?: string;
  status?: string;
  direction?: string;
  type?: string;
  system?: boolean;
}

/** Same rule as the app's spendValue(). */
export function spendOf(e: RawEntry): number {
  const amt = Number(e.amount) || 0;
  if (amt <= 0) return 0;
  switch (e.kind) {
    case 'expense':
      return e.status === 'PAID' || MOVES_MONEY.includes(e.category ?? '') ? 0 : amt;
    case 'card':
      return e.direction === 'credit' ? (e.category === 'Refund' ? -amt : 0) : amt;
    case 'wallet':
      return e.type === 'spend' ? amt : e.type === 'refund' ? -amt : 0;
    default:
      return 0;
  }
}

/** checkins: 'YYYY-MM-DD' keys (the user's local = IST day) marked "Nothing spent today". */
export function buildDays(entries: RawEntry[], checkins: string[] = []): Days {
  const days: Days = new Map();
  const at = (k: number) => days.get(k) ?? (days.set(k, { spend: 0, logged: false }), days.get(k)!);
  for (const e of entries) {
    if (!e.date || isNaN(e.date.getTime())) continue;
    const d = at(istDay(e.date));
    d.spend = Math.round((d.spend + spendOf(e)) * 100) / 100;
    if (!e.system) d.logged = true;
  }
  for (const k of checkins) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    if (m) at(istDay(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 6, 30)))).logged = true;
  }
  return days;
}

/** Completed run of days ending the day before `today` that satisfy `ok`, never before `since`. */
export function runBefore(days: Days, today: number, since: number, ok: (d: Day) => boolean, max = 400): number {
  let n = 0;
  for (let k = today - 1; k >= since && n < max; k--) {
    if (!ok(days.get(k) ?? { spend: 0, logged: false })) break;
    n++;
  }
  return n;
}

export const isNoSpend = (d: Day) => d.spend <= 0;
export const isLogged = (d: Day) => d.logged;
export const withinLimit = (limit: number) => (d: Day) => d.spend <= limit;

export interface Push {
  title: string;
  body: string;
  route: string;
  tag: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
/** Same phrasing every time for a given day, different across days. */
const pick = <T>(list: T[], seed: number) => list[Math.abs(seed) % list.length];

/**
 * Morning: celebrate a milestone reached YESTERDAY (one push, the biggest one). Nothing otherwise —
 * no guilt pushes for broken streaks.
 */
export function morningCelebration(days: Days, today: number, since: number, limit: number): Push | null {
  const runs: { kind: string; n: number; rank: number }[] = [
    { kind: 'noSpend', n: runBefore(days, today, since, isNoSpend), rank: 3 },
    { kind: 'withinLimit', n: limit > 0 ? runBefore(days, today, since, withinLimit(limit)) : 0, rank: 2 },
    { kind: 'logging', n: runBefore(days, today, since, isLogged), rank: 1 },
  ];
  // Spending streaks only mean something while you're using the app: a day you didn't open it looks
  // exactly like a no-spend day. So they're celebrated only if something was logged in the last 3 days.
  const active = [1, 2, 3].some(i => days.get(today - i)?.logged);
  // A no-spend day is also within the limit: only the biggest milestone is celebrated.
  const hit = runs.filter(r => MILESTONES.includes(r.n) && (r.kind === 'logging' || active)).sort((a, b) => b.n - a.n || b.rank - a.rank)[0];
  if (!hit) return null;
  const n = hit.n;
  const seed = today + n;
  const text: Record<string, { title: string[]; body: string[] }> = {
    noSpend: {
      title: [`${n} no-spend days in a row 🎉`, `🏆 ${n}-day no-spend streak`],
      body: ['Yesterday made it official. Every rupee you didn’t spend is still yours.', 'That’s real discipline — see how far you can take it.'],
    },
    withinLimit: {
      title: [`${n} days within your limit 🎯`, `🏅 ${n}-day within-limit streak`],
      body: [`Stayed under ${inr(limit)} a day, ${n} days running. Brilliant control.`, 'Consistent days add up to a calm month. Keep it going.'],
    },
    logging: {
      title: [`🔥 ${n}-day logging streak`, `${n} days of money logged 🔥`],
      body: ['Every day accounted for — this is how budgets actually work.', 'Small daily habit, big clarity. Nicely done.'],
    },
  };
  const t = text[hit.kind];
  return { title: pick(t.title, seed), body: pick(t.body, seed + 1), route: '/streaks', tag: 'streak' };
}

/**
 * Evening: nothing logged today → a nudge, but only for people who have been using the app this
 * week (so a lapsed user isn't nagged every night). Mentions the logging streak when there is one.
 */
export function eveningCheckin(days: Days, today: number, since: number): Push | null {
  if (days.get(today)?.logged) return null;
  let active = false;
  for (let k = today - 1; k >= today - 7; k--) if (days.get(k)?.logged) active = true;
  if (!active) return null;
  const run = runBefore(days, today, since, isLogged);
  if (run >= 2) {
    return {
      title: pick([`Keep your ${run}-day streak 🔥`, `Your ${run}-day streak needs today`], today),
      body: 'Nothing logged today yet. Add what you spent — or tap “Nothing spent today”.',
      route: '/streaks',
      tag: 'checkin',
    };
  }
  return {
    title: pick(['Anything to log today?', 'Quick money check-in'], today),
    body: 'A minute now keeps your numbers right. Spent nothing? Mark it and start a streak.',
    route: '/streaks',
    tag: 'checkin',
  };
}

/** Monday of the IST week containing day `k` (istDay 0 = Thu 1 Jan 1970 → Monday offset 3). */
export function weekStart(k: number): number {
  return k - ((k + 3) % 7);
}

/** Sunday evening recap of the week so far (Mon–today) against the whole previous week. */
export function weeklyRecap(days: Days, today: number, since: number, limit: number): Push | null {
  const start = weekStart(today);
  let spent = 0, prev = 0, noSpend = 0, logged = 0, over = 0;
  for (let k = start; k <= today; k++) {
    if (k < since) continue;
    const d = days.get(k) ?? { spend: 0, logged: false };
    spent += Math.max(0, d.spend);
    if (d.spend <= 0) noSpend++;
    if (d.logged) logged++;
    if (limit > 0 && d.spend > limit) over++;
  }
  for (let k = start - 7; k < start; k++) prev += Math.max(0, days.get(k)?.spend ?? 0);
  if (!logged && !spent) return null;
  const parts = [`${inr(spent)} spent`];
  if (prev > 0) {
    const pct = Math.round(((spent - prev) / prev) * 100);
    parts[0] += pct < 0 ? ` (${-pct}% less than last week)` : pct > 0 ? ` (${pct}% more than last week)` : ' (same as last week)';
  }
  if (noSpend) parts.push(`${noSpend} no-spend day${noSpend === 1 ? '' : 's'}`);
  if (limit > 0) parts.push(over ? `${over} day${over === 1 ? '' : 's'} over your limit` : 'every day within your limit');
  const run = runBefore(days, today + 1, since, isLogged);
  if (run >= 2) parts.push(`${run}-day logging streak`);
  const good = prev > 0 ? spent <= prev : over === 0;
  return {
    title: good ? 'Your week: nicely done 👏' : 'Your week in money',
    body: parts.join(' · ') + '.',
    route: '/streaks',
    tag: 'weekly',
  };
}

/** IST hour (0–23) and weekday (0 = Sunday) for `now`. */
export function istClock(now: Date): { hour: number; weekday: number; day: number } {
  const s = new Date(now.getTime() + 330 * 60 * 1000);
  return { hour: s.getUTCHours(), weekday: s.getUTCDay(), day: istDay(now) };
}
