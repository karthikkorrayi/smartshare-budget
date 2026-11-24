import { CARD_DEFAULTS, Card, CardTxnLite, StatementLite, billingCycle, cardPosition, positionWindowStart, usageTone } from './card.model';

const D = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function card(o: Partial<Card> = {}): Card {
  return {
    id: 'k1', userId: 'u', cardholderName: 'K', bankName: 'HDFC Bank', nickname: 'Millennia', lastFourDigits: '4242',
    expiryMonth: 8, expiryYear: 2030, statementDay: 12, dueDay: 2, status: 'Active', dailySpendingLimit: 0,
    createdAt: D(2026, 1, 1), lastUpdated: null, lastUpdateSource: 'manual', ...CARD_DEFAULTS, benefits: [], ...o,
  };
}
const tx = (d: Date, amount: number, direction: 'debit' | 'credit' = 'debit', category = 'Food'): CardTxnLite => ({ cardId: 'k1', txnDate: d, amount, direction, category });
const st = (statementDate: Date, totalDue: number, paidAmount = 0, minDue = 500, status = paidAmount >= totalDue ? 'Paid' : paidAmount ? 'Partially Paid' : 'Unpaid'): StatementLite =>
  ({ cardId: 'k1', statementDate, dueDate: new Date(statementDate.getFullYear(), statementDate.getMonth() + 1, 2, 12), totalDue, minDue, paidAmount, status });

describe('billingCycle', () => {
  it('statement 12th, due 2nd, on 24 Nov: next statement 12 Dec, pay by 2 Jan', () => {
    const c = billingCycle({ statementDay: 12, dueDay: 2 }, D(2026, 11, 24));
    expect(ymd(c.cycleStart)).toBe('2026-11-13');
    expect(ymd(c.nextStatement)).toBe('2026-12-12');
    expect(ymd(c.nextDue)).toBe('2027-01-02');
    expect(c.freeDays).toBe(39);
    expect(c.maxFreeDays).toBe(50);
  });
  it('a purchase on the statement day lands on that day\'s statement', () => {
    const c = billingCycle({ statementDay: 12, dueDay: 2 }, D(2026, 11, 12));
    expect(ymd(c.nextStatement)).toBe('2026-11-12');
    expect(ymd(c.nextDue)).toBe('2026-12-02');
  });
  it('day 31 is clamped to the month (Feb → 28th) and due later in the same month works', () => {
    const c = billingCycle({ statementDay: 31, dueDay: 20 }, D(2027, 2, 10));
    expect(ymd(c.nextStatement)).toBe('2027-02-28');
    expect(ymd(c.nextDue)).toBe('2027-03-20');
  });
});

describe('cardPosition — one definition of what you owe', () => {
  const today = D(2026, 11, 24);

  it('with a statement: unpaid statements + spends − refunds after it; bill payments are not subtracted twice', () => {
    const c = card({ creditLimit: 100000 });
    const stmts = [st(D(2026, 10, 12), 20000, 5000, 1000), st(D(2026, 11, 12), 12000, 0, 600)];
    const txns = [
      tx(D(2026, 11, 12), 999),                 // on the statement day → already on the statement, not unbilled
      tx(D(2026, 11, 13), 3000),                // after → unbilled
      tx(D(2026, 11, 20), 500, 'credit', 'Refund'),
      tx(D(2026, 11, 21), 5000, 'credit', 'Card Payment'), // a bill payment: tracked on the statement, ignored here
    ];
    const p = cardPosition(c, stmts, txns, today);
    expect(p.billed).toBe(15000 + 12000);
    expect(p.unbilled).toBe(2500);
    expect(p.used).toBe(29500);
    expect(p.available).toBe(70500);
    expect(p.usedPct).toBe(30);
    expect(p.overLimit).toBeFalse();
    expect(p.minDue).toBe(1600);
  });

  it('before any statement: opening outstanding + debits − all credits since the "as of" date', () => {
    const c = card({ creditLimit: 50000, openingOutstanding: 8000, openingAsOf: D(2026, 11, 15) });
    const txns = [tx(D(2026, 11, 10), 7000), tx(D(2026, 11, 16), 2000), tx(D(2026, 11, 18), 3000, 'credit', 'Card Payment')];
    const p = cardPosition(c, [], txns, today);
    expect(p.billed).toBe(8000);
    expect(p.unbilled).toBe(-1000);
    expect(p.used).toBe(7000);
    expect(p.available).toBe(43000);
  });

  it('a statement older than the opening date is ignored (the opening figure is newer)', () => {
    const c = card({ openingOutstanding: 4000, openingAsOf: D(2026, 11, 20) });
    const p = cardPosition(c, [st(D(2026, 11, 12), 99999)], [], today);
    expect(p.used).toBe(4000);
  });

  it('never below zero; over-limit detected; no limit → no available/percent', () => {
    expect(cardPosition(card(), [], [tx(D(2026, 11, 20), 100, 'credit', 'Refund')], today).used).toBe(0);
    const over = cardPosition(card({ creditLimit: 1000 }), [], [tx(D(2026, 11, 20), 1500)], today);
    expect(over.overLimit).toBeTrue();
    expect(over.available).toBe(-500);
    const noLimit = cardPosition(card(), [], [tx(D(2026, 11, 20), 1500)], today);
    expect(noLimit.available).toBeNull();
    expect(noLimit.usedPct).toBeNull();
  });

  it('interest if only the minimum is paid, fee waiver progress, rewards', () => {
    const c = card({ interestMonthly: 3.5, annualFee: 1000, feeWaiverSpend: 100000, rewardType: 'points', rewardRate: 4, rewardBalance: 2000, rewardValue: 0.25 });
    const p = cardPosition(c, [st(D(2026, 11, 12), 10000, 0, 500)], [tx(D(2026, 11, 14), 5000), tx(D(2026, 3, 1), 20000)], today);
    expect(p.interestIfMinimum).toBe(332.5); // (10000 − 500) × 3.5%
    expect(p.cycleSpend).toBe(5000);
    expect(p.yearSpend).toBe(25000);
    expect(p.waiverPct).toBe(25);
    expect(p.rewardsWorth).toBe(500);
    expect(p.rewardsThisCycle).toBe(200); // 5000 / 100 × 4
    const cb = cardPosition(card({ rewardType: 'cashback', rewardRate: 1.5 }), [], [tx(D(2026, 11, 14), 2000)], today);
    expect(cb.rewardsThisCycle).toBe(30);
  });

  it('only this card\'s statements and transactions count', () => {
    const other = { ...tx(D(2026, 11, 20), 9999), cardId: 'k2' };
    const p = cardPosition(card(), [{ ...st(D(2026, 11, 12), 5000), cardId: 'k2' }], [other], today);
    expect(p.used).toBe(0);
  });
});

describe('helpers', () => {
  it('query window reaches back to the oldest anchor (statement / opening date), at least a year', () => {
    const today = D(2026, 11, 24);
    expect(ymd(positionWindowStart([card({ createdAt: D(2026, 6, 1) })], [], today))).toBe('2025-11-23');
    expect(ymd(positionWindowStart([card({ openingAsOf: D(2025, 1, 5), createdAt: D(2025, 1, 5) })], [], today))).toBe('2025-01-05');
  });
  it('usage tone bands', () => {
    expect([usageTone(null), usageTone(10), usageTone(30), usageTone(55), usageTone(90)]).toEqual(['', 'pos', 'pos', 'warn', 'neg']);
  });
});
