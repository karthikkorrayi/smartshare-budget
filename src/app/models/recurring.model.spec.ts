import {
  describeChanges,
  monthlyEquivalent,
  nextOccurrence,
  occurrencesBetween,
  paymentsLeft,
  planSummary,
  recurringFrom,
  schedule,
  statusOf,
} from './recurring.model';

/** Local noon, the way the app stores due dates. */
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);
const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;

const base = (over: any = {}) =>
  recurringFrom({ id: 'p1', description: 'Rent', amount: 1000, frequency: 'monthly', dueDate: d(2026, 1, 31), ...over });

describe('recurring model — schedule', () => {
  it('keeps the anchor day across short months (31 Jan → 28 Feb → 31 Mar)', () => {
    const p = base({ anchorDay: 31 });
    expect(schedule(p, 3).map(ymd)).toEqual(['2026-1-31', '2026-2-28', '2026-3-31']);
  });

  it('an advanced due date (28 Feb) still returns to the 31st through anchorDay', () => {
    const p = base({ dueDate: d(2026, 2, 28), anchorDay: 31 });
    expect(ymd(nextOccurrence(p.dueDate, 'monthly', 30, p.anchorDay))).toBe('2026-3-31');
    expect(schedule(p, 2).map(ymd)).toEqual(['2026-2-28', '2026-3-31']);
  });

  it('old documents without anchorDay use the due day', () => {
    const p = base({ dueDate: d(2026, 3, 15) });
    expect(p.anchorDay).toBe(15);
  });
});

describe('recurring model — end conditions', () => {
  it('count plans (EMIs) stop after the remaining installments', () => {
    const p = base({ dueDate: d(2026, 1, 5), endType: 'count', installmentsTotal: 12, installmentsPaid: 10 });
    expect(paymentsLeft(p)).toBe(2);
    expect(schedule(p, 6).length).toBe(2);
  });

  it('date plans include the end date itself', () => {
    const p = base({ dueDate: d(2026, 1, 5), endType: 'date', endDate: d(2026, 4, 5) });
    expect(paymentsLeft(p)).toBe(4);
    const after = base({ dueDate: d(2026, 5, 5), endType: 'date', endDate: d(2026, 4, 5) });
    expect(paymentsLeft(after)).toBe(0);
  });

  it('no end = Infinity; completed = 0 and nothing scheduled', () => {
    expect(paymentsLeft(base())).toBe(Infinity);
    const done = base({ completed: true });
    expect(paymentsLeft(done)).toBe(0);
    expect(schedule(done).length).toBe(0);
    expect(statusOf(done, d(2026, 6, 1)).status).toBe('completed');
  });
});

describe('recurring model — occurrencesBetween', () => {
  it('counts every weekly due date in a 30-day window (was undercounted as 1)', () => {
    const p = base({ frequency: 'weekly', amount: 200, dueDate: d(2026, 11, 24) });
    expect(occurrencesBetween(p, d(2026, 11, 24), d(2026, 12, 23)).length).toBe(5);
  });

  it('includes the overdue unpaid date only when asked', () => {
    const p = base({ dueDate: d(2026, 11, 20) });
    expect(occurrencesBetween(p, d(2026, 11, 24), d(2026, 12, 23)).map(ymd)).toEqual(['2026-12-20']);
    expect(occurrencesBetween(p, d(2026, 11, 24), d(2026, 12, 23), true).map(ymd)).toEqual(['2026-11-20', '2026-12-20']);
  });

  it('respects the remaining installments', () => {
    const p = base({ frequency: 'weekly', dueDate: d(2026, 11, 24), endType: 'count', installmentsTotal: 2 });
    expect(occurrencesBetween(p, d(2026, 11, 1), d(2026, 12, 31)).length).toBe(2);
  });
});

describe('recurring model — planSummary', () => {
  it('works out the monthly, yearly and remaining totals for an EMI', () => {
    const p = base({ amount: 5000, dueDate: d(2026, 12, 5), endType: 'count', installmentsTotal: 6, installmentsPaid: 2 });
    const s = planSummary(p, d(2026, 12, 1));
    expect(s.sentence).toContain('every month on the 5th');
    expect(s.monthly).toBe(5000);
    expect(s.yearly).toBe(60000);
    expect(s.left).toBe(4);
    expect(s.remainingTotal).toBe(20000);
    expect(ymd(s.lastDate!)).toBe('2027-3-5');
    expect(s.thisMonth).toEqual({ count: 1, total: 5000 });
  });

  it('open-ended plans have no remaining total; weekly monthly-equivalent is 52/12', () => {
    const p = base({ frequency: 'weekly', amount: 120, dueDate: d(2026, 12, 1) });
    const s = planSummary(p, d(2026, 12, 1));
    expect(s.left).toBeNull();
    expect(s.remainingTotal).toBeNull();
    expect(s.monthly).toBe(520);
    expect(monthlyEquivalent(p)).toBeCloseTo(520, 5);
  });

  it('ordinals: 1st, 2nd, 3rd, 11th, 22nd', () => {
    const on = (day: number) => planSummary(base({ dueDate: d(2026, 12, day) }), d(2026, 12, 1)).sentence;
    expect(on(1)).toContain('1st');
    expect(on(2)).toContain('2nd');
    expect(on(3)).toContain('3rd');
    expect(on(11)).toContain('11th');
    expect(on(22)).toContain('22nd');
  });
});

describe('recurring model — describeChanges', () => {
  it('lists only what changed, with the monthly effect of an amount change', () => {
    const before = base({ dueDate: d(2026, 12, 5) });
    const same = describeChanges(before, { ...before });
    expect(same).toEqual([]);
    const lines = describeChanges(before, { ...before, amount: 1300, dueDate: d(2026, 12, 7) });
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('₹1,000 → ₹1,300');
    expect(lines[0]).toContain('+₹300 a month');
    expect(lines[1]).toContain('Next due');
  });

  it('notices an end-condition change', () => {
    const before = base();
    expect(describeChanges(before, { ...before, endType: 'count', installmentsTotal: 12 })).toContain('End of the plan changed');
  });
});
