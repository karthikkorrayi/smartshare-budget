/**
 * Daily due-date digest (pure logic, unit-tested in test/reminders.test.ts).
 * All "calendar day" maths is done in India Standard Time.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;

export interface CardLite {
  id: string;
  userId: string;
  bankName: string;
  nickname?: string;
  lastFourDigits: string;
  statementDay: number;
  dueDay: number;
  status: string;
}

export interface StatementLite {
  id: string;
  userId: string;
  cardId: string;
  statementDate: Date;
  dueDate: Date;
  totalDue: number;
  minDue: number;
  paidAmount: number;
  status: string;
}

export interface DueReminder {
  kind: 'overdue' | 'due_soon' | 'statement_tomorrow';
  cardId: string;
  text: string;
  sortKey: number;
}

/** Days since epoch for the IST calendar day containing `d`. */
export function istDay(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / 86_400_000);
}

/** IST calendar date parts for `d`. */
export function istParts(d: Date): { y: number; m: number; day: number } {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), day: s.getUTCDate() };
}

function label(c: CardLite): string {
  return `${c.nickname || c.bankName} ••${c.lastFourDigits}`;
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/** Does the card's statement fall on the IST day after `now` (day clamped to month length)? */
export function statementIsTomorrow(c: CardLite, now: Date): boolean {
  const t = istParts(new Date(now.getTime() + 86_400_000));
  const last = new Date(Date.UTC(t.y, t.m + 1, 0)).getUTCDate();
  return Math.min(c.statementDay, last) === t.day;
}

export function computeDueReminders(cards: CardLite[], statements: StatementLite[], now: Date, leadDays = 3): DueReminder[] {
  const today = istDay(now);
  const out: DueReminder[] = [];
  for (const c of cards) {
    if (c.status !== 'Active') continue;
    for (const s of statements) {
      if (s.cardId !== c.id || s.status === 'Paid') continue;
      const outstanding = Math.max(0, s.totalDue - s.paidAmount);
      if (outstanding <= 0) continue;
      const days = istDay(s.dueDate) - today;
      if (days < 0) {
        out.push({ kind: 'overdue', cardId: c.id, sortKey: days, text: `${label(c)}: ${inr(outstanding)} overdue by ${-days} day${days === -1 ? '' : 's'}` });
      } else if (days <= leadDays) {
        const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
        out.push({ kind: 'due_soon', cardId: c.id, sortKey: days, text: `${label(c)}: ${inr(outstanding)} due ${when} (min ${inr(s.minDue)})` });
      }
    }
    if (statementIsTomorrow(c, now)) {
      out.push({ kind: 'statement_tomorrow', cardId: c.id, sortKey: 100, text: `${label(c)}: statement generates tomorrow` });
    }
  }
  return out.sort((a, b) => a.sortKey - b.sortKey);
}

/** One push per user per day: title + up to 3 lines. */
export function digest(reminders: DueReminder[]): { title: string; body: string } | null {
  if (!reminders.length) return null;
  const overdue = reminders.filter(r => r.kind === 'overdue').length;
  const due = reminders.filter(r => r.kind === 'due_soon').length;
  const title = overdue
    ? `⚠️ ${overdue} card payment${overdue === 1 ? '' : 's'} overdue`
    : due
      ? `⏰ ${due} card payment${due === 1 ? '' : 's'} due soon`
      : '🗓️ Card statement tomorrow';
  const lines = reminders.slice(0, 3).map(r => r.text);
  if (reminders.length > 3) lines.push(`+${reminders.length - 3} more`);
  return { title, body: lines.join('\n') };
}
