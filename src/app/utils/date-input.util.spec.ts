import { checkDay, dueMoment, entryMoment, fromDateInput, toDateInput } from './date-input.util';

describe('date-input.util — one rule for stored dates', () => {
  const now = new Date(2026, 10, 24, 20, 15); // 24 Nov 2026, 8:15 pm local

  it('reads and writes calendar days in local time (no UTC shift)', () => {
    const d = fromDateInput('2026-11-01')!;
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(10);
    expect(toDateInput(d)).toBe('2026-11-01');
    expect(fromDateInput('2026-13-01')).toBeNull();
    expect(fromDateInput('2026-02-31')).toBeNull();
    expect(fromDateInput('2028-02-29')).not.toBeNull(); // leap year
    expect(fromDateInput('')).toBeNull();
  });

  it('entryMoment: today → now, other days → 12:00, edits keep their original time', () => {
    expect(entryMoment('2026-11-24', null, now)).toBe(now);
    const past = entryMoment('2026-11-20', null, now);
    expect([past.getDate(), past.getHours()]).toEqual([20, 12]);
    const original = new Date(2026, 10, 20, 9, 41);
    expect(entryMoment('2026-11-20', original, now)).toBe(original); // same day → untouched
    const moved = entryMoment('2026-11-21', original, now);
    expect([moved.getDate(), moved.getHours()]).toEqual([21, 12]); // day changed → noon of the new day
  });

  it('dueMoment is always 12:00 local, so the day survives UTC readers', () => {
    const d = dueMoment('2026-12-02');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 11, 2, 12]);
    // 12:00 IST is 06:30 UTC — still the same calendar day in UTC.
    expect(d.toISOString().slice(0, 10)).toBe('2026-12-02');
  });

  it('checkDay validates required, future/past, range and typo years', () => {
    expect(checkDay('', { label: 'the date' }, now)).toBe('Pick the date.');
    expect(checkDay('', { label: 'the due date', required: false }, now)).toBeNull();
    expect(checkDay('2026-11-25', { label: 'the date', notFuture: true }, now)).toContain("can't be in the future");
    expect(checkDay('2026-11-24', { label: 'the date', notFuture: true }, now)).toBeNull();
    expect(checkDay('2026-11-23', { label: 'the due date', notPast: true }, now)).toContain("can't be in the past");
    expect(checkDay('2026-11-10', { label: 'the due date', min: '2026-11-12' }, now)).toContain('on or after');
    expect(checkDay('2062-11-10', { label: 'the date' }, now)).toContain('looks wrong');
  });
});
