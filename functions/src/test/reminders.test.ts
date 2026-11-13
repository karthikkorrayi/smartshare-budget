import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillLite, CardLite, StatementLite, computeBillReminders, computeDueReminders, digest, istDay, statementIsTomorrow } from '../reminders';

// 9:00 AM IST on 12 Nov 2026 = 03:30 UTC
const now = new Date('2026-11-12T03:30:00Z');
const ist = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 6, 30)); // noon IST

const card = (o: Partial<CardLite> = {}): CardLite => ({
  id: 'c1', userId: 'u', bankName: 'HDFC Bank', nickname: 'Millennia', lastFourDigits: '4242',
  statementDay: 20, dueDay: 8, status: 'Active', ...o,
});
const stmt = (o: Partial<StatementLite> = {}): StatementLite => ({
  id: 's1', userId: 'u', cardId: 'c1', statementDate: ist(2026, 10, 20), dueDate: ist(2026, 11, 14),
  totalDue: 18450, minDue: 920, paidAmount: 0, status: 'Unpaid', ...o,
});

test('IST day boundary: 23:59 IST and 00:01 IST are different days', () => {
  assert.equal(istDay(new Date('2026-11-12T18:29:00Z')) + 1, istDay(new Date('2026-11-12T18:31:00Z')));
});

test('due in 2 days is reported with amount and minimum', () => {
  const r = computeDueReminders([card()], [stmt()], now, 3);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'due_soon');
  assert.match(r[0].text, /₹18,450 due in 2 days \(min ₹920\)/);
});

test('beyond lead time is ignored; paid and closed are ignored', () => {
  assert.equal(computeDueReminders([card()], [stmt({ dueDate: ist(2026, 11, 20) })], now, 3).length, 0);
  assert.equal(computeDueReminders([card()], [stmt({ status: 'Paid', paidAmount: 18450 })], now).length, 0);
  assert.equal(computeDueReminders([card({ status: 'Closed' })], [stmt()], now).length, 0);
});

test('overdue sorts first and uses outstanding amount', () => {
  const r = computeDueReminders(
    [card()],
    [stmt(), stmt({ id: 's0', dueDate: ist(2026, 11, 10), paidAmount: 450, status: 'Partially Paid' })],
    now
  );
  assert.equal(r[0].kind, 'overdue');
  assert.match(r[0].text, /₹18,000 overdue by 2 days/);
});

test('statement tomorrow, with day clamped to month length', () => {
  assert.equal(statementIsTomorrow(card({ statementDay: 13 }), now), true);
  assert.equal(statementIsTomorrow(card({ statementDay: 14 }), now), false);
  // 30 Nov 2026 09:00 IST → tomorrow is 1 Dec? No: test 29 Nov → tomorrow 30 Nov, statementDay 31 clamps to 30.
  assert.equal(statementIsTomorrow(card({ statementDay: 31 }), new Date('2026-11-29T03:30:00Z')), true);
});

test('digest headline + line limit', () => {
  const r = computeDueReminders(
    [card(), card({ id: 'c2', lastFourDigits: '1111', statementDay: 13 })],
    [stmt(), stmt({ id: 's2', dueDate: ist(2026, 11, 11) }), stmt({ id: 's3', cardId: 'c2', dueDate: ist(2026, 11, 12) })],
    now
  );
  const d = digest(r)!;
  assert.match(d.title, /1 card payment overdue/);
  assert.equal(d.body.split('\n').length, 4); // 3 lines + "+1 more"
  assert.equal(digest([]), null);
});

// ── Bills / recurring payments (redesign) ─────────────────────────
const bill = (o: Partial<BillLite> = {}): BillLite => ({
  id: 'b1', userId: 'u', description: 'Electricity', amount: 1840, dueDate: ist(2026, 11, 13), ...o,
});

test('bill due tomorrow is reminded with its amount', () => {
  const r = computeBillReminders([bill()], now, 3);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'bill_due');
  assert.match(r[0].text, /Electricity: ₹1,840 due tomorrow/);
});

test('bill reminder respects its own reminderDays and skips paused payments', () => {
  assert.equal(computeBillReminders([bill({ dueDate: ist(2026, 11, 20) })], now, 3).length, 0);
  assert.equal(computeBillReminders([bill({ dueDate: ist(2026, 11, 20), reminderDays: 10 })], now, 3).length, 1);
  assert.equal(computeBillReminders([bill({ paused: true })], now, 3).length, 0);
  assert.equal(computeBillReminders([bill({ dueDate: new Date(NaN) })], now, 3).length, 0);
});

test('overdue bill is reported once and the digest counts it as a payment', () => {
  const r = computeBillReminders([bill({ dueDate: ist(2026, 11, 9) })], now, 3);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'bill_overdue');
  const d = digest(r)!;
  assert.match(d.title, /1 payment overdue/);
  assert.doesNotMatch(d.title, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test('cards and bills are merged into one digest, overdue first', () => {
  const d = digest([...computeDueReminders([card()], [stmt()], now, 3), ...computeBillReminders([bill({ dueDate: ist(2026, 11, 10) })], now, 3)])!;
  assert.match(d.title, /1 payment overdue/);
  assert.match(d.body.split('\n')[0], /Electricity/);
});
