/**
 * Financial-discipline streaks (pure, unit-tested). Local calendar days.
 * The server (functions/src/discipline.ts) applies the same rules for push notifications:
 *   spending — the budget rule (spendValue): bill payments / top-ups / repaid loans don't count, refunds reduce
 *   logged   — any entry you made that day, or "Nothing spent today"
 * Streaks count COMPLETED days, never before the account existed; today joins once it counts.
 */
import { addDays, dayKey } from './spending.util';

export const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
export const BADGE_STEPS = [3, 7, 14, 30, 60, 100, 365];

export interface DisciplineDay {
  spend: number;
  logged: boolean;
  checkin: boolean;
}
export type DayMap = Map<string, DisciplineDay>;
export type StreakKind = 'logging' | 'noSpend' | 'withinLimit';

export function buildDayMap(txns: { date: Date; spend: number; system: boolean }[], checkins: string[] = []): DayMap {
  const m: DayMap = new Map();
  const at = (k: string) => m.get(k) ?? (m.set(k, { spend: 0, logged: false, checkin: false }), m.get(k)!);
  for (const t of txns) {
    if (!(t.date instanceof Date) || isNaN(t.date.getTime())) continue;
    const d = at(dayKey(t.date));
    d.spend = Math.round((d.spend + (Number(t.spend) || 0)) * 100) / 100;
    if (!t.system) d.logged = true;
  }
  for (const k of checkins) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const d = at(k);
    d.logged = true;
    d.checkin = true;
  }
  return m;
}

const EMPTY: DisciplineDay = { spend: 0, logged: false, checkin: false };
const get = (m: DayMap, d: Date) => m.get(dayKey(d)) ?? EMPTY;

const RULES: Record<StreakKind, (limit: number) => (d: DisciplineDay) => boolean> = {
  logging: () => d => d.logged,
  noSpend: () => d => d.spend <= 0,
  withinLimit: limit => d => d.spend <= limit,
};

/** Completed days ending yesterday that pass `ok`, never before `since`. */
export function completedRun(m: DayMap, today: Date, since: Date, ok: (d: DisciplineDay) => boolean, max = 400): number {
  const floor = dayKey(since);
  let n = 0;
  for (let i = 1; i <= max; i++) {
    const d = addDays(today, -i);
    if (dayKey(d) < floor || !ok(get(m, d))) break;
    n++;
  }
  return n;
}

/** Longest run in [max(since, today − window), today], today included when it already counts. */
export function bestRun(m: DayMap, today: Date, since: Date, ok: (d: DisciplineDay) => boolean, todayCounts: boolean, window = 400): number {
  const floor = dayKey(since);
  let best = 0, run = 0;
  for (let i = window; i >= 0; i--) {
    const d = addDays(today, -i);
    if (dayKey(d) < floor) continue;
    const pass = i === 0 ? todayCounts : ok(get(m, d));
    run = pass ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export type TodayState = 'kept' | 'so-far' | 'at-risk' | 'broken' | 'idle';

export interface Streak {
  kind: StreakKind;
  title: string;
  icon: string;
  /** Streak shown now: completed days + today when today already counts. */
  current: number;
  /** Completed days ending yesterday. */
  completed: number;
  today: TodayState;
  todayText: string;
  best: number;
  next: number | null;
  toNext: number;
  /** 0–1 toward the next milestone. */
  progress: number;
  available: boolean;
}

export interface CalDay {
  date: Date;
  state: 'before' | 'future' | 'nospend' | 'within' | 'over' | 'spent';
  logged: boolean;
  checkin: boolean;
  today: boolean;
  spend: number;
}

export interface Badge {
  kind: StreakKind;
  days: number;
  earned: boolean;
}

export interface Motivation {
  icon: string;
  title: string;
  text: string;
  tone: 'celebrate' | 'nudge' | 'steady' | 'reset';
}

export interface Discipline {
  streaks: Streak[];
  today: { spend: number; logged: boolean; checkin: boolean; limit: number };
  /** 12 weeks, Monday-first columns, oldest first. */
  calendar: CalDay[];
  badges: Badge[];
  message: Motivation;
  bests: Record<StreakKind, number>;
}

const TITLES: Record<StreakKind, { title: string; icon: string }> = {
  logging: { title: 'Logging streak', icon: 'flame' },
  noSpend: { title: 'No-spend streak', icon: 'leaf' },
  withinLimit: { title: 'Within daily limit', icon: 'target' },
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function computeDiscipline(
  m: DayMap,
  today: Date,
  since: Date,
  limit: number,
  storedBest: Partial<Record<StreakKind, number>> = {},
  now: Date = today
): Discipline {
  const t = get(m, today);
  const kinds: StreakKind[] = ['logging', 'noSpend', 'withinLimit'];
  const streaks = kinds.map(kind => {
    const available = kind !== 'withinLimit' || limit > 0;
    const ok = RULES[kind](limit);
    const completed = available ? completedRun(m, today, since, ok) : 0;
    let state: TodayState;
    let todayCounts = false;
    if (!available) state = 'idle';
    else if (kind === 'logging') {
      todayCounts = t.logged;
      state = t.logged ? 'kept' : completed > 0 ? 'at-risk' : 'idle';
    } else {
      todayCounts = ok(t);
      state = todayCounts ? 'so-far' : completed > 0 ? 'broken' : 'idle';
    }
    // Spending past the line today ends the streak now (the day can't recover), so it shows 0.
    const current = !available || state === 'broken' ? 0 : completed + (todayCounts ? 1 : 0);
    const best = available ? Math.max(storedBest[kind] ?? 0, bestRun(m, today, since, ok, todayCounts)) : storedBest[kind] ?? 0;
    const next = MILESTONES.find(x => x > current) ?? null;
    const prev = [...MILESTONES].reverse().find(x => x <= current) ?? 0;
    const todayText = todayLine(kind, state, completed, limit, t.spend);
    return {
      kind, ...TITLES[kind], current, completed, today: state, todayText, best, available,
      next, toNext: next ? next - current : 0, progress: next ? (current - prev) / (next - prev) : 1,
    } satisfies Streak;
  });

  // Calendar: 12 full weeks ending with the current week (Monday first).
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const start = addDays(monday, -77);
  const floor = dayKey(since), tk = dayKey(today);
  const calendar: CalDay[] = [];
  for (let i = 0; i < 84; i++) {
    const d = addDays(start, i);
    const k = dayKey(d);
    const v = get(m, d);
    const state: CalDay['state'] = k > tk ? 'future' : k < floor ? 'before' : v.spend <= 0 ? 'nospend' : limit > 0 ? (v.spend <= limit ? 'within' : 'over') : 'spent';
    calendar.push({ date: d, state, logged: v.logged, checkin: v.checkin, today: k === tk, spend: v.spend });
  }

  const bests = Object.fromEntries(streaks.map(s => [s.kind, s.best])) as Record<StreakKind, number>;
  const badges: Badge[] = kinds
    .filter(k => k !== 'withinLimit' || limit > 0 || (storedBest.withinLimit ?? 0) > 0)
    .flatMap(kind => BADGE_STEPS.map(days => ({ kind, days, earned: bests[kind] >= days })));

  return {
    streaks,
    today: { spend: t.spend, logged: t.logged, checkin: t.checkin, limit },
    calendar,
    badges,
    message: motivation(streaks, t, limit, today, now),
    bests,
  };
}

function todayLine(kind: StreakKind, s: TodayState, completed: number, limit: number, spent: number): string {
  if (kind === 'withinLimit' && !(limit > 0)) return 'Set a daily limit to start this streak.';
  switch (kind) {
    case 'logging':
      return s === 'kept' ? 'Today is logged ✓' : s === 'at-risk' ? 'Log something today to keep it going.' : 'Log today to start one.';
    case 'noSpend':
      return s === 'so-far' ? 'No spending so far today — it counts when the day ends.' : s === 'broken' ? `Ended today after ${plural(completed, 'day')}. Tomorrow is a fresh start.` : 'A day with no spending starts one.';
    default:
      return s === 'so-far'
        ? `₹${Math.round(Math.max(0, limit - spent)).toLocaleString('en-IN')} left in today's limit.`
        : s === 'broken' ? `Over today's limit — your ${plural(completed, 'day')} run resets tomorrow.` : 'Stay within your limit today to start one.';
  }
}

/** One line, chosen by situation; the wording rotates daily but is stable within a day. */
export function motivation(streaks: Streak[], t: DisciplineDay, limit: number, today: Date, now: Date): Motivation {
  const seed = Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 86_400_000);
  const pick = <T,>(xs: T[]) => xs[Math.abs(seed) % xs.length];
  const by = (k: StreakKind) => streaks.find(s => s.kind === k)!;
  const log = by('logging'), ns = by('noSpend'), wl = by('withinLimit');

  // 1. A milestone reached today (or completed yesterday).
  const hit = [ns, wl, log].filter(s => s.available && MILESTONES.includes(s.current) && s.today !== 'broken').sort((a, b) => b.current - a.current)[0];
  if (hit) {
    const n = hit.current;
    const what = hit.kind === 'logging' ? 'days logged in a row' : hit.kind === 'noSpend' ? 'no-spend days in a row' : 'days within your limit';
    return { icon: 'trophy', tone: 'celebrate', title: `${n} ${what}!`, text: pick(['That’s a milestone — be proud of it.', 'Discipline like this compounds. Keep going.', 'Milestone unlocked. The next one is closer than you think.']) };
  }
  // 2. Evening and today isn't logged yet, with a streak running.
  if (log.today === 'at-risk' && now.getHours() >= 18) {
    return { icon: 'flame', tone: 'nudge', title: `Your ${log.completed}-day streak needs today`, text: 'Add today’s spending — or tap “Nothing spent today” if there was none.' };
  }
  // 3. Over the limit today: no guilt, a reset.
  if (wl.available && wl.today === 'broken') {
    return { icon: 'sunrise', tone: 'reset', title: 'Tomorrow is a fresh start', text: pick([`Today went over the limit. Your best run is ${plural(wl.best, 'day')} — you've done it before.`, 'One day doesn’t undo good habits. Reset and go again tomorrow.']) };
  }
  // 4. Close to the next milestone.
  const near = [log, ns, wl].filter(s => s.available && s.next && s.toNext <= 2 && s.current >= 2 && s.today !== 'broken').sort((a, b) => a.toNext - b.toNext)[0];
  if (near) {
    const n = near.toNext;
    const what = near.kind === 'logging' ? `more logged ${n === 1 ? 'day' : 'days'}` : near.kind === 'noSpend' ? `more no-spend ${n === 1 ? 'day' : 'days'}` : `more ${n === 1 ? 'day' : 'days'} within your limit`;
    return { icon: 'target', tone: 'steady', title: `${n} ${what} to reach ${near.next}`, text: pick(['You’re almost there.', 'So close — keep the run alive.']) };
  }
  // 5. A good run going.
  if (log.current >= 3) {
    return { icon: 'flame', tone: 'steady', title: `${log.current} days logged in a row`, text: pick(['Every day accounted for — this is how budgets actually work.', 'Small daily habit, big clarity.', 'Consistency beats intensity. Nicely done.']) };
  }
  if (ns.current >= 1 && ns.today === 'so-far') {
    return { icon: 'leaf', tone: 'steady', title: 'No spending so far today', text: 'Every rupee you don’t spend is still yours.' };
  }
  // 6. Starting out.
  return { icon: 'sparkles', tone: 'steady', title: 'Every streak starts with one day', text: t.logged ? 'Today is logged. Come back tomorrow to make it two.' : 'Log today’s spending — or mark it as a no-spend day — to begin.' };
}
