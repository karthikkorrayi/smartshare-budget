import { BADGE_STEPS, buildDayMap, completedRun, computeDiscipline, bestRun } from './discipline.util';

const d = (m: number, day: number, h = 12) => new Date(2026, m - 1, day, h);
const today = d(11, 25);
const since = d(1, 1);
const spend = (m: number, day: number, amount: number, system = false) => ({ date: d(m, day), spend: amount, system });

describe('discipline — days and runs', () => {
  it('a day is logged by an entry you made or a "nothing spent" check-in, not by system income', () => {
    const m = buildDayMap([spend(11, 22, 0, true), spend(11, 23, 100)], ['2026-11-24']);
    expect(m.get('2026-11-22')!.logged).toBeFalse();
    expect(m.get('2026-11-23')!.logged).toBeTrue();
    expect(m.get('2026-11-24')!.checkin).toBeTrue();
    expect(completedRun(m, today, since, x => x.logged)).toBe(2);
  });

  it('never counts days before the account existed', () => {
    const m = buildDayMap([]);
    expect(completedRun(m, today, d(11, 22), x => x.spend <= 0)).toBe(3);
  });

  it('refunds reduce a day’s spend (same as the budget)', () => {
    const m = buildDayMap([spend(11, 24, 500), spend(11, 24, -500)]);
    expect(m.get('2026-11-24')!.spend).toBe(0);
  });

  it('best run includes today only when today already counts', () => {
    const m = buildDayMap([spend(11, 20, 10), spend(11, 21, 10), spend(11, 22, 10), spend(11, 24, 10)]);
    expect(bestRun(m, today, since, x => x.logged, false)).toBe(3);
    expect(bestRun(m, today, since, x => x.logged, true)).toBe(3);
  });
});

describe('discipline — streak cards', () => {
  it('logging: today joins once logged; otherwise the streak is at risk', () => {
    const m = buildDayMap([spend(11, 22, 100), spend(11, 23, 100), spend(11, 24, 100)]);
    let s = computeDiscipline(m, today, since, 0).streaks.find(x => x.kind === 'logging')!;
    expect(s.completed).toBe(3);
    expect(s.current).toBe(3);
    expect(s.today).toBe('at-risk');
    const logged = buildDayMap([spend(11, 22, 100), spend(11, 23, 100), spend(11, 24, 100), spend(11, 25, 50)]);
    s = computeDiscipline(logged, today, since, 0).streaks.find(x => x.kind === 'logging')!;
    expect(s.current).toBe(4);
    expect(s.today).toBe('kept');
    expect(s.next).toBe(7);
    expect(s.toNext).toBe(3);
    expect(s.progress).toBeCloseTo(0.25, 5);
  });

  it('no-spend: today counts "so far"; spending today breaks it with a fresh-start note', () => {
    const quiet = computeDiscipline(buildDayMap([spend(11, 21, 100)], ['2026-11-22', '2026-11-23', '2026-11-24']), today, since, 0);
    const ns = quiet.streaks.find(x => x.kind === 'noSpend')!;
    expect(ns.completed).toBe(3);
    expect(ns.current).toBe(4);
    expect(ns.today).toBe('so-far');
    const spent = computeDiscipline(buildDayMap([spend(11, 21, 100), spend(11, 25, 80)], ['2026-11-22', '2026-11-23', '2026-11-24']), today, since, 0);
    const b = spent.streaks.find(x => x.kind === 'noSpend')!;
    expect(b.current).toBe(0);
    expect(b.today).toBe('broken');
    expect(b.todayText).toContain('fresh start');
  });

  it('within limit needs a limit; over the limit today resets with a positive message', () => {
    const m = buildDayMap([spend(11, 23, 400), spend(11, 24, 900), spend(11, 25, 1200)]);
    expect(computeDiscipline(m, today, d(11, 23), 0).streaks.find(x => x.kind === 'withinLimit')!.available).toBeFalse();
    // Account from 24 Nov: logging is 2 days (no milestone), so the over-limit reset message shows.
    const r = computeDiscipline(m, today, d(11, 24), 1000);
    const wl = r.streaks.find(x => x.kind === 'withinLimit')!;
    expect(wl.completed).toBe(1);
    expect(wl.current).toBe(0);
    expect(wl.today).toBe('broken');
    expect(r.message.tone).toBe('reset');
    expect(r.message.title).toContain('fresh start');
  });

  it('keeps the stored best when it is higher than anything in the loaded window', () => {
    const r = computeDiscipline(buildDayMap([spend(11, 25, 10)]), today, since, 0, { logging: 45 });
    expect(r.bests.logging).toBe(45);
    expect(r.badges.filter(b => b.kind === 'logging' && b.earned).map(b => b.days)).toEqual(BADGE_STEPS.filter(x => x <= 45));
  });
});

describe('discipline — calendar and messages', () => {
  it('12 Monday-first weeks ending this week, with states', () => {
    const r = computeDiscipline(buildDayMap([spend(11, 24, 1500), spend(11, 23, 300)]), today, d(11, 1), 1000);
    expect(r.calendar.length).toBe(84);
    expect(r.calendar[0].date.getDay()).toBe(1);
    expect(r.calendar.find(c => c.today)!.date.getDate()).toBe(25);
    const k = (m: number, day: number) => r.calendar.find(c => c.date.getMonth() === m - 1 && c.date.getDate() === day)!.state;
    expect(k(11, 24)).toBe('over');
    expect(k(11, 23)).toBe('within');
    expect(k(11, 22)).toBe('nospend');
    expect(k(10, 20)).toBe('before');
    expect(k(11, 29)).toBe('future');
  });

  it('celebrates a milestone, nudges in the evening when today is not logged, and starts gently', () => {
    const seven = buildDayMap([1, 2, 3, 4, 5, 6].map(i => spend(11, 25 - i, 50)), []);
    const logged7 = new Map(seven);
    logged7.set('2026-11-25', { spend: 10, logged: true, checkin: false });
    expect(computeDiscipline(logged7, today, since, 0).message.tone).toBe('celebrate');
    const evening = computeDiscipline(seven, today, since, 0, {}, d(11, 25, 20));
    expect(evening.message.tone).toBe('nudge');
    expect(evening.message.title).toContain('6-day');
    expect(computeDiscipline(buildDayMap([spend(11, 25, 50)]), today, d(11, 25), 0).message.title).toContain('starts with one day');
  });
});
