import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDays, eveningCheckin, istClock, morningCelebration, RawEntry, runBefore, isLogged, isNoSpend, spendOf, weekStart, weeklyRecap } from '../discipline';
import { istDay } from '../reminders';

// Noon IST on a given date.
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 6, 30));
const today = istDay(at(2026, 11, 25)); // Wednesday
const since = istDay(at(2026, 1, 1));
const exp = (d: Date, amount: number, o: Partial<RawEntry> = {}): RawEntry => ({ kind: 'expense', date: d, amount, ...o });

test('spending rule matches the app: bill payments, top-ups, repaid loans and card credits', () => {
  assert.equal(spendOf(exp(at(2026, 11, 1), 500)), 500);
  assert.equal(spendOf(exp(at(2026, 11, 1), 500, { category: 'Card Bill' })), 0);
  assert.equal(spendOf(exp(at(2026, 11, 1), 500, { category: 'Wallet Top-up' })), 0);
  assert.equal(spendOf(exp(at(2026, 11, 1), 500, { status: 'PAID' })), 0);
  assert.equal(spendOf({ kind: 'card', date: null, amount: 300, direction: 'debit' }), 300);
  assert.equal(spendOf({ kind: 'card', date: null, amount: 300, direction: 'credit', category: 'Refund' }), -300);
  assert.equal(spendOf({ kind: 'card', date: null, amount: 300, direction: 'credit', category: 'Payment' }), 0);
  assert.equal(spendOf({ kind: 'wallet', date: null, amount: 80, type: 'spend' }), 80);
  assert.equal(spendOf({ kind: 'wallet', date: null, amount: 80, type: 'topup' }), 0);
  assert.equal(spendOf({ kind: 'income', date: null, amount: 9000 }), 0);
});

test('logged days: entries you made and "nothing spent" check-ins; system income does not count', () => {
  const days = buildDays(
    [{ kind: 'income', date: at(2026, 11, 22), amount: 100, system: true }, { kind: 'transfer', date: at(2026, 11, 23), amount: 5 }],
    ['2026-11-24']
  );
  assert.equal(days.get(today - 3)?.logged, false);
  assert.equal(days.get(today - 2)?.logged, true);
  assert.equal(days.get(today - 1)?.logged, true);
  assert.equal(runBefore(days, today, since, isLogged), 2);
});

test('IST day boundary: 11:50 PM IST counts for that day, not the next', () => {
  const late = new Date('2026-11-24T18:20:00Z'); // 11:50 PM IST, 24 Nov
  const days = buildDays([exp(late, 10)]);
  assert.equal(days.get(today - 1)?.spend, 10);
});

test('morning: celebrates a milestone reached yesterday, the biggest one, once', () => {
  // Spent ₹400 on 18–21 Nov and checked in "nothing spent" on 22–24 Nov:
  // logging 7 days (milestone), no-spend 3 days (milestone) → the bigger one, logging 7, is sent.
  const entries = [4, 5, 6, 7].map(i => exp(at(2026, 11, 25 - i), 400));
  const checkins = ['2026-11-22', '2026-11-23', '2026-11-24'];
  const days = buildDays(entries, checkins);
  assert.equal(runBefore(days, today, since, isLogged), 7);
  assert.equal(runBefore(days, today, since, isNoSpend), 3);
  const p = morningCelebration(days, today, since, 0)!;
  assert.match(p.title, /7/);
  assert.match(p.title, /logg/i);
  assert.equal(p.route, '/streaks');
  // A day later the logging run is 8 and no-spend is broken — nothing to celebrate, nothing sent.
  const next = buildDays([...entries, exp(at(2026, 11, 25), 100)], checkins);
  assert.equal(morningCelebration(next, today + 1, since, 0), null);
});

test('morning: a within-limit milestone (limit set, new account) is celebrated', () => {
  const entries = [1, 2, 3, 4, 5, 6, 7].map(i => exp(at(2026, 11, 25 - i), 700));
  const p = morningCelebration(buildDays(entries), today, today - 7, 1000)!;
  // within-limit 7 ties with logging 7 → within-limit ranks higher
  assert.match(p.title + p.body, /limit/i);
});

test('morning: spending streaks of an inactive user are not celebrated (a skipped day looks like no-spend)', () => {
  const days = buildDays([exp(at(2026, 11, 20), 50)]); // last activity 5 days ago → 4 empty days
  assert.equal(runBefore(days, today, since, isNoSpend), 4);
  assert.equal(morningCelebration(buildDays([exp(at(2026, 11, 21), 50)]), today, since, 0), null);
});

test('morning: never counts days before the account existed', () => {
  const days = buildDays([], ['2026-11-22', '2026-11-23', '2026-11-24']);
  assert.ok(morningCelebration(days, today, since, 0));
  assert.equal(morningCelebration(days, today, today - 2, 0), null); // only 2 days old
});

test('evening: nudges an active user who logged nothing today, mentioning the streak', () => {
  const days = buildDays([exp(at(2026, 11, 23), 100), exp(at(2026, 11, 24), 100)]);
  const p = eveningCheckin(days, today, since)!;
  assert.match(p.title, /2-day/);
  assert.equal(eveningCheckin(buildDays([exp(at(2026, 11, 25), 1)]), today, since), null, 'already logged today');
  assert.equal(eveningCheckin(buildDays([exp(at(2026, 11, 10), 1)]), today, since), null, 'inactive for a week');
  assert.doesNotMatch(eveningCheckin(buildDays([exp(at(2026, 11, 20), 1)]), today, since)!.title, /streak/);
});

test('weekly recap compares with last week and counts no-spend days', () => {
  const sunday = istDay(at(2026, 11, 29));
  assert.equal(weekStart(sunday), istDay(at(2026, 11, 23)));
  assert.equal(weekStart(istDay(at(2026, 11, 23))), istDay(at(2026, 11, 23)), 'Monday starts its own week');
  const days = buildDays([
    exp(at(2026, 11, 17), 2000), // last week
    exp(at(2026, 11, 24), 600), exp(at(2026, 11, 26), 900), // this week
  ]);
  const p = weeklyRecap(days, sunday, since, 1000)!;
  assert.match(p.body, /₹1,500 spent \(25% less than last week\)/);
  assert.match(p.body, /5 no-spend days/);
  assert.match(p.body, /every day within your limit/);
  assert.match(p.title, /nicely done/);
  assert.equal(weeklyRecap(buildDays([]), sunday, since, 0), null);
});

test('IST clock: hour and weekday', () => {
  const c = istClock(new Date('2026-11-29T15:30:00Z')); // 9:00 PM IST Sunday
  assert.equal(c.hour, 21);
  assert.equal(c.weekday, 0);
});
