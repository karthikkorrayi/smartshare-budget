/** Helpers for <input type="date"> and calendar-day maths, all in LOCAL time (IST-safe). */

/** 'YYYY-MM-DD' for <input type="date">. */
export function toDateInput(date: Date | null | undefined): string {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parses <input type="date"> as local midnight. `new Date('2026-11-11')` would be UTC and shift the day. */
export function fromDateInput(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, day);
  // Reject impossible days instead of letting them roll over (2026-02-31 → 3 Mar, 2026-13-01 → Jan 2027).
  if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
  return d;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `from` to `to` (negative = in the past). */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Day-of-month clamped to the month's length (statement day 31 → 30 Nov, 28/29 Feb). */
export function dayInMonth(year: number, monthIndex: number, day: number): Date {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, last));
}

/** Next date (today or later) that falls on the given day-of-month. */
export function nextDayOfMonth(day: number, from = new Date()): Date {
  const today = startOfDay(from);
  const thisMonth = dayInMonth(today.getFullYear(), today.getMonth(), day);
  return thisMonth >= today ? thisMonth : dayInMonth(today.getFullYear(), today.getMonth() + 1, day);
}

/** 'YYYY-MM' → [first day, first day of next month). */
export function monthRange(month: string): [Date, Date] {
  const [y, m] = month.split('-').map(Number);
  return [new Date(y, m - 1, 1), new Date(y, m, 1)];
}

export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

// ── One rule for turning a picked calendar day into the moment we store ───────
// Stored moments are local times. Midnight is avoided: in IST, local midnight is 18:30 UTC of the
// previous day, so anything reading the date in UTC (Cloud Functions, exports) would see the day before.

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Moment to store for an entry (expense, income, transaction, repayment…) picked as `day`:
 *  - editing and the day didn't change → the original moment (an edit never moves an entry's time);
 *  - the day is today → now (keeps today's list in the order things happened);
 *  - any other day → 12:00 local.
 */
export function entryMoment(day: Date | string, original?: Date | null, now = new Date()): Date {
  const d = typeof day === 'string' ? fromDateInput(day) : day;
  if (!d) throw new Error('entryMoment: invalid day');
  if (original && sameDay(original, d)) return original;
  if (sameDay(d, now)) return now;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
}

/** Moment to store for a due / statement / schedule date: always 12:00 local on that day. */
export function dueMoment(day: Date | string): Date {
  const d = typeof day === 'string' ? fromDateInput(day) : day;
  if (!d) throw new Error('dueMoment: invalid day');
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
}

/** Today as 'YYYY-MM-DD' (for [max] on pickers of things that already happened). */
export function todayInput(now = new Date()): string {
  return toDateInput(now);
}

/**
 * Validates a picked day. Returns an error sentence or null.
 *   checkDay(v, { label: 'the expense date', notFuture: true })
 * `maxYearsBack` stops typos like 2062 / 1926 (default 10 years either way).
 */
export function checkDay(
  value: string | null | undefined,
  opts: { label: string; required?: boolean; notFuture?: boolean; notPast?: boolean; min?: string; max?: string; maxYears?: number } = { label: 'the date' },
  now = new Date()
): string | null {
  const required = opts.required ?? true;
  if (!value) return required ? `Pick ${opts.label}.` : null;
  const d = fromDateInput(value);
  if (!d) return `${cap(opts.label)} isn't a valid date.`;
  const today = toDateInput(now);
  if (opts.notFuture && value > today) return `${cap(opts.label)} can't be in the future.`;
  if (opts.notPast && value < today) return `${cap(opts.label)} can't be in the past.`;
  if (opts.min && value < opts.min) return `${cap(opts.label)} must be on or after ${fmtDay(opts.min)}.`;
  if (opts.max && value > opts.max) return `${cap(opts.label)} must be on or before ${fmtDay(opts.max)}.`;
  const years = opts.maxYears ?? 10;
  if (Math.abs(d.getFullYear() - now.getFullYear()) > years) return `${cap(opts.label)} looks wrong (${d.getFullYear()}).`;
  return null;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtDay(v: string): string {
  return fromDateInput(v)?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) ?? v;
}
