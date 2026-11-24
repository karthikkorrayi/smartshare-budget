import { cashHistory, netWorth } from './wealth.util';
import { lendingFrom } from '../models/lending.model';
import { loanFrom, loanStatus } from '../models/loan.model';
import { recurringFrom } from '../models/recurring.model';
import { fromExpense, fromIncome, fromTransfer } from './analytics.util';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);
const today = d(2026, 11, 25);
const acc = (type: 'bank' | 'wallet' | 'card', id: string, balance: number, status: 'Active' | 'Closed' = 'Active'): any => ({
  ref: { type, id }, key: `${type}:${id}`, name: id, subtitle: '', type, balance, inWealth: type !== 'card' && status === 'Active', status, icon: 'x', art: type, lastActivity: null,
});
const accounts = [acc('bank', 'hdfc', 80000), acc('bank', 'old', 5000, 'Closed'), acc('wallet', 'cash', 2000), acc('card', 'amex', 12000), acc('card', 'gone', 0, 'Closed')];
const lending = [
  lendingFrom({ id: 'r1', title: 'Rahul', amount: 5000, status: 'PENDING', settledAmount: 1000 }),
  lendingFrom({ id: 'r2', title: 'Rahul', amount: 800, status: 'PENDING', direction: 'borrowed' }),
  lendingFrom({ id: 'r3', title: 'Priya', amount: 300, status: 'PAID' }),
];
const loan = loanFrom({ id: 'L', name: 'Car loan', kind: 'car', principal: 500000, rate: 9, tenureMonths: 60, firstEmiDate: d(2026, 1, 5), recurringId: 'p1' });
const plans = [
  recurringFrom({ id: 'p1', description: 'Car loan EMI', amount: 10379.18, category: 'EMI', frequency: 'monthly', dueDate: d(2026, 12, 5), endType: 'count', installmentsTotal: 60, installmentsPaid: 11 }),
  recurringFrom({ id: 'p2', description: 'Phone EMI', amount: 2500, category: 'EMI', frequency: 'monthly', dueDate: d(2026, 12, 10), endType: 'count', installmentsTotal: 12, installmentsPaid: 8 }),
  recurringFrom({ id: 'p3', description: 'Netflix', amount: 649, category: 'Bills', frequency: 'monthly', dueDate: d(2026, 12, 1) }),
];

describe('wealth — net worth by category', () => {
  const nw = netWorth(accounts, lending, [loan], plans, today);
  const g = (id: string) => nw.groups.find(x => x.id === id)!;

  it('assets: active banks and wallets, plus money still owed to you', () => {
    expect(g('bank').total).toBe(80000); // closed account excluded
    expect(g('wallet').total).toBe(2000);
    expect(g('owed').total).toBe(4000); // 5000 − 1000 repaid; settled Priya excluded
    expect(nw.assets).toBe(86000);
  });

  it('liabilities: cards owed, loan principal (once, not its EMI plan too), other EMIs, borrowed', () => {
    expect(g('cards').total).toBe(12000);
    const outstanding = loanStatus(loan, { installmentsPaid: 11 }, today).outstanding;
    expect(g('loans').total).toBe(outstanding);
    expect(g('emis').lines.map(l => l.label)).toEqual(['Phone EMI']); // the car EMI is the loan; Netflix isn't debt
    expect(g('emis').total).toBe(10000); // 4 × 2500
    expect(g('borrowed').total).toBe(800); // gross, not netted against what Rahul owes
    expect(nw.liabilities).toBeCloseTo(12000 + outstanding + 10000 + 800, 2);
    expect(nw.net).toBeCloseTo(nw.assets - nw.liabilities, 2);
  });

  it('a closed loan and a completed EMI plan owe nothing', () => {
    const closed = loanFrom({ ...loan.raw, id: 'L', status: 'closed' });
    const done = plans.map(p => (p.id === 'p2' ? recurringFrom({ ...p.raw, id: 'p2', completed: true }) : p));
    const n = netWorth(accounts, lending, [closed], done, today);
    expect(n.groups.find(x => x.id === 'loans')!.total).toBe(0);
    expect(n.groups.find(x => x.id === 'emis')!.total).toBe(0);
  });
});

describe('wealth — cash & bank history', () => {
  const tdocs = [
    fromIncome({ id: 'i1', amount: 50000, date: d(2026, 11, 1), accountType: 'bank', accountId: 'hdfc' }, x => x as Date),
    fromExpense({ id: 'e1', amount: 3000, date: d(2026, 10, 20), category: 'Food', accountType: 'bank', accountId: 'hdfc' }, x => x as Date),
    fromTransfer({ id: 't1', fromType: 'bank', fromId: 'hdfc', toType: 'wallet', toId: 'cash', amount: 1000, date: d(2026, 11, 3) }),
  ];

  it('works back from today: month end = now − what moved after it; transfers between them cancel', () => {
    const h = cashHistory(accounts, tdocs, ['2026-09', '2026-10', '2026-11'], today);
    expect(h[2].amount).toBe(82000); // today: 80000 + 2000 (closed account excluded)
    expect(h[1].amount).toBe(32000); // before the ₹50,000 income on 1 Nov
    expect(h[0].amount).toBe(35000); // and before the ₹3,000 spent on 20 Oct
  });
});
