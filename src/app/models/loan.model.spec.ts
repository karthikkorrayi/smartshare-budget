import { amortize, emiDate, loanFrom, loanStatus, standardEmi } from './loan.model';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);
const home = (o: any = {}) => loanFrom({ id: 'l1', name: 'Home loan', principal: 1_000_000, rate: 9, tenureMonths: 240, firstEmiDate: d(2026, 1, 5), ...o });

describe('loan model — EMI and schedule', () => {
  it('standard EMI matches the bank formula (₹10 lakh, 9 %, 20 years → ₹8,997.26)', () => {
    expect(standardEmi(1_000_000, 9, 240)).toBe(8997.26);
    expect(standardEmi(120_000, 0, 12)).toBe(10_000);
    expect(standardEmi(0, 9, 12)).toBe(0);
  });

  it('amortizes to zero in the tenure; total interest ≈ ₹11.59 lakh', () => {
    const rows = amortize(1_000_000, 9, 8997.26, d(2026, 1, 5));
    expect(rows.length).toBe(240);
    expect(rows[rows.length - 1].balance).toBe(0);
    expect(Math.round(rows.reduce((s, r) => s + r.interest, 0))).toBe(1_159_342);
    expect(rows[0].interest).toBe(7500);
    expect(rows[11].balance).toBeCloseTo(981_272.89, 2);
  });

  it('a bigger EMI repays sooner; an EMI below the interest is rejected', () => {
    expect(amortize(1_000_000, 9, 12_000, d(2026, 1, 5)).length).toBeLessThan(240);
    expect(amortize(1_000_000, 9, 7_000, d(2026, 1, 5))).toEqual([]);
  });

  it('EMI dates keep the day, clamped in short months', () => {
    expect(emiDate(d(2026, 1, 31), 1).getDate()).toBe(28);
    expect(emiDate(d(2026, 1, 31), 2).getDate()).toBe(31);
    expect(emiDate(d(2026, 11, 5), 2).getFullYear()).toBe(2027);
  });
});

describe('loan model — status', () => {
  it('a rounded-up EMI repays within the tenure for any rate (no 241st month)', () => {
    for (const rate of [7.25, 8.5, 9, 10.4, 12.99, 15]) {
      const emi = standardEmi(2_500_000, rate, 240);
      const rows = amortize(2_500_000, rate, emi, d(2026, 1, 5));
      expect(rows.length).withContext(`${rate}%`).toBe(240);
      expect(rows[239].balance).toBe(0);
      expect(Math.abs(rows[239].emi - emi)).withContext(`${rate}% last EMI`).toBeLessThan(emi * 0.01 + 1);
    }
  });

  it('an EMI due today is not counted as paid yet', () => {
    expect(loanStatus(home(), null, d(2026, 2, 5)).paid).toBe(1);
    expect(loanStatus(home(), null, d(2026, 2, 6)).paid).toBe(2);
  });

  it('without a linked EMI payment, every EMI date before today counts as paid', () => {
    const s = loanStatus(home(), null, d(2026, 12, 20));
    expect(s.paid).toBe(12);
    expect(s.outstanding).toBeCloseTo(981_272.89, 2);
    expect(s.nextDate!.getMonth()).toBe(0); // Jan 2027
    expect(s.progress).toBeCloseTo((1_000_000 - 981_272.89) / 1_000_000, 6);
    expect(s.interestPaid + s.interestLeft).toBeCloseTo(s.totalInterest, 2);
  });

  it('with a linked EMI payment, its installment count decides', () => {
    const s = loanStatus(home(), { installmentsPaid: 3 }, d(2026, 12, 20));
    expect(s.paid).toBe(3);
    expect(s.outstanding).toBe(s.rows[2].balance);
  });

  it('a closed loan owes nothing', () => {
    const s = loanStatus(home({ status: 'closed' }), null, d(2026, 3, 1));
    expect(s.outstanding).toBe(0);
    expect(s.nextDate).toBeNull();
    expect(s.interestLeft).toBe(0);
  });

  it('an EMI that does not cover the interest is flagged, and the principal still counts as owed', () => {
    const s = loanStatus(home({ emi: 5000 }), null, d(2026, 6, 1));
    expect(s.invalid).toBeTrue();
    expect(s.outstanding).toBe(1_000_000);
  });

  it('reads defaults: EMI from the formula when not stored, unknown kind → other', () => {
    const l = loanFrom({ id: 'x', principal: 120000, rate: 0, tenureMonths: 12, kind: 'yacht' });
    expect(l.emi).toBe(10000);
    expect(l.kind).toBe('other');
  });
});
