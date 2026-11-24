import { balanceAt, balanceSeries, largest, topPayees } from './account-insights.util';
import { fromCardTxn, fromExpense, fromIncome, fromTransfer } from './analytics.util';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);
const id = (x: unknown) => x as Date;
const bank = { type: 'bank' as const, id: 'b1' };
const txns = [
  fromIncome({ id: 'i1', amount: 50000, date: d(2026, 11, 1), source: 'Salary', accountType: 'bank', accountId: 'b1' }, id),
  fromExpense({ id: 'e1', amount: 1200, date: d(2026, 11, 5), description: 'Swiggy', category: 'Food', accountType: 'bank', accountId: 'b1' }, id),
  fromExpense({ id: 'e2', amount: 800, date: d(2026, 11, 9), description: 'swiggy ', category: 'Food', accountType: 'bank', accountId: 'b1' }, id),
  fromExpense({ id: 'e3', amount: 18000, date: d(2026, 11, 10), description: 'Rent', category: 'Rent', accountType: 'bank', accountId: 'b1' }, id),
  fromExpense({ id: 'e4', amount: 999, date: d(2026, 11, 12), description: 'Other bank', category: 'Food', accountType: 'bank', accountId: 'b2' }, id),
  fromTransfer({ id: 't1', fromType: 'bank', fromId: 'b1', toType: 'wallet', toId: 'w1', amount: 2000, date: d(2026, 11, 15) }),
];

describe('account insights', () => {
  it('works balances back from today; other accounts don’t affect it', () => {
    const now = 60000;
    expect(balanceAt(now, bank, txns, d(2026, 11, 16))).toBe(60000);
    expect(balanceAt(now, bank, txns, d(2026, 11, 11))).toBe(62000); // before the transfer out
    expect(balanceAt(now, bank, txns, new Date(2026, 10, 1))).toBe(60000 + 2000 + 18000 + 800 + 1200 - 50000);
  });

  it('balance series uses today’s balance for buckets ending in the future', () => {
    const s = balanceSeries(60000, bank, txns, [new Date(2026, 10, 2), new Date(2026, 11, 1)], d(2026, 11, 25));
    expect(s).toEqual([60000 + 2000 + 18000 + 800 + 1200, 60000]);
  });

  it('top payees group the same description and rank by amount', () => {
    const p = topPayees(txns.filter(t => t.account?.id === 'b1'));
    expect(p[0]).toEqual(jasmine.objectContaining({ name: 'Rent', amount: 18000, count: 1 }));
    expect(p[1]).toEqual(jasmine.objectContaining({ amount: 2000, count: 2 }));
  });

  it('largest movements in either direction, including card spends for a card', () => {
    const l = largest(txns, bank, 2);
    expect(l.map(x => x.effect)).toEqual([50000, -18000]);
    const card = { type: 'card' as const, id: 'c1' };
    const ct = [fromCardTxn({ id: 'c', cardId: 'c1', amount: 4500, txnDate: d(2026, 11, 3), direction: 'debit', description: 'Flight' })];
    expect(largest(ct, card)[0].effect).toBe(-4500);
  });
});
