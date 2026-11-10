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
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
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
