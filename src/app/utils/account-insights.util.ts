/**
 * Per-account analytics helpers (pure, unit-tested): balance history worked back from today's
 * balance, where the money went, and the biggest transactions.
 */
import { AccountRef } from '../models/account.model';
import { FinanceTxn, balanceEffect } from './analytics.util';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Balance at the moment `at` (exclusive): today's balance minus everything that moved the account
 * from `at` onwards. `txns` must include every transaction from `at` to today.
 */
export function balanceAt(current: number, ref: AccountRef, txns: FinanceTxn[], at: Date): number {
  return r2(current - txns.filter(t => t.date >= at).reduce((s, t) => s + balanceEffect(t, ref), 0));
}

/** Closing balance after each bucket (bucket ends are exclusive instants, e.g. next day / next month start). */
export function balanceSeries(current: number, ref: AccountRef, txns: FinanceTxn[], ends: Date[], now = new Date()): number[] {
  return ends.map(end => (end > now ? r2(current) : balanceAt(current, ref, txns, end)));
}

export interface Payee {
  name: string;
  amount: number;
  count: number;
  category: string;
}

/** Where the spending went, grouped by description (case and spacing ignored). */
export function topPayees(txns: FinanceTxn[], n = 5): Payee[] {
  const m = new Map<string, Payee>();
  for (const t of txns) {
    if (!(t.spend > 0)) continue;
    const name = (t.title || t.category || 'Other').trim();
    const k = name.toLowerCase().replace(/\s+/g, ' ');
    const p = m.get(k) ?? { name, amount: 0, count: 0, category: t.category };
    p.amount = r2(p.amount + t.spend);
    p.count++;
    m.set(k, p);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || b.count - a.count).slice(0, n);
}

/** Biggest money movements for this account (either direction; transfers included). */
export function largest(txns: FinanceTxn[], ref: AccountRef, n = 5): { t: FinanceTxn; effect: number }[] {
  return txns
    .map(t => ({ t, effect: balanceEffect(t, ref) || (t.kind === 'card' ? -t.spend : 0) }))
    .filter(x => x.effect !== 0)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, n);
}
