import { balanceEffect, byCategory, dailyInsight, fromCardTxn, fromExpense, fromIncome, fromTransfer, fromWalletTxn, habits, monthsIn, rangeFor, totals } from './analytics.util';
import { nextOccurrence, schedule, statusOf, recurringFrom } from '../models/recurring.model';
import { lendingFrom } from '../models/lending.model';

const td = (v: unknown) => (v instanceof Date ? v : null);
const D = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('analytics.util — one definition of income and spending', () => {
  const list = [
    fromExpense({ id: 'e1', amount: 1000, category: 'Food', date: D(2026, 11, 3), accountType: 'bank', accountId: 'b1' }, td),
    fromExpense({ id: 'e2', amount: 5000, category: 'Card Bill', date: D(2026, 11, 4), accountType: 'bank', accountId: 'b1' }, td),
    fromIncome({ id: 'i1', amount: 50000, source: 'Salary', date: D(2026, 11, 1), accountType: 'bank', accountId: 'b1' }, td),
    fromIncome({ id: 'cf', amount: 9000, source: 'Carry Forward', date: D(2026, 11, 1), isSystemGenerated: true, isCarryForward: true }, td),
    fromCardTxn({ id: 'c1', cardId: 'k1', amount: 2000, direction: 'debit', category: 'Shopping', txnDate: D(2026, 11, 5) }),
    fromCardTxn({ id: 'c2', cardId: 'k1', amount: 500, direction: 'credit', category: 'Refund', txnDate: D(2026, 11, 6) }),
    fromWalletTxn({ id: 'w1', walletId: 'w', type: 'spend', amount: 300, category: 'Food', date: D(2026, 11, 7) }),
    fromWalletTxn({ id: 'w2', walletId: 'w', type: 'topup', amount: 1000, date: D(2026, 11, 7) }),
    fromTransfer({ id: 't1', fromType: 'bank', fromId: 'b1', toType: 'wallet', toId: 'w', amount: 1000, date: D(2026, 11, 7) }),
  ];

  it('excludes carry-forward from income, card bills / top-ups / transfers from spending, nets refunds', () => {
    const t = totals(list);
    expect(t.income).toBe(50000);
    expect(t.spent).toBe(1000 + 2000 - 500 + 300);
    expect(t.net).toBe(50000 - 2800);
    expect(t.refunds).toBe(500);
  });

  it('bank balance effect counts every linked rupee, including card bills and transfers out', () => {
    const ref = { type: 'bank' as const, id: 'b1' };
    const eff = list.reduce((s, t) => s + balanceEffect(t, ref), 0);
    expect(eff).toBe(50000 - 1000 - 5000 - 1000);
  });

  it('categories ignore refunds and moves', () => {
    const c = byCategory(list);
    expect(c.map(x => x.name)).toEqual(['Shopping', 'Food']);
    expect(c[1].amount).toBe(1300);
  });

  it('daily insight uses real days, not a percentage of the month', () => {
    const r = { start: D(2026, 11, 1, 0), end: D(2026, 11, 11, 0) };
    const i = dailyInsight(list, r, D(2026, 11, 10));
    expect(i.days).toBe(10);
    expect(i.average).toBe(280);
    expect(i.highest?.amount).toBe(2000);
  });

  it('ranges and month keys', () => {
    const r = rangeFor('3m', D(2026, 1, 15));
    expect(monthsIn(r.start, r.end)).toEqual(['2025-11', '2025-12', '2026-01']);
    const c = rangeFor('custom', D(2026, 11, 13), { start: D(2020, 1, 1), end: D(2026, 11, 13) });
    expect(monthsIn(c.start, c.end).length).toBe(24);
  });

  it('logging streak only counts real, user-entered activity', () => {
    const h = habits([fromExpense({ id: 'a', amount: 1, date: D(2026, 11, 13) }, td), fromExpense({ id: 'b', amount: 1, date: D(2026, 11, 12) }, td),
      fromIncome({ id: 'cf', amount: 1, date: D(2026, 11, 11), isSystemGenerated: true, isCarryForward: true }, td)], null, D(2026, 11, 13));
    expect(h.loggingStreak).toBe(2);
  });
});

describe('recurring + lending models', () => {
  it('monthly schedule keeps the anchor day across short months', () => {
    expect(nextOccurrence(D(2026, 1, 31), 'monthly').getDate()).toBe(28);
    const s = schedule({ dueDate: D(2026, 1, 31), frequency: 'monthly', intervalDays: 30 }, 3);
    expect(s[2].getDate()).toBe(31);
  });

  it('old upcoming_payments documents read as one-time payments', () => {
    const p = recurringFrom({ id: 'x', description: 'Bill', amount: 100, dueDate: D(2026, 11, 10) });
    expect(p.frequency).toBe('once');
    expect(statusOf(p, D(2026, 11, 13)).status).toBe('overdue');
  });

  it('old receivables read as money lent; partial repayments reduce what is outstanding', () => {
    const r = lendingFrom({ id: 'r', title: 'Rahul', amount: 5000, status: 'PENDING', settledAmount: 2000 });
    expect(r.direction).toBe('lent');
    expect(r.outstanding).toBe(3000);
  });
});
