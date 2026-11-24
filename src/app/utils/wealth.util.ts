/**
 * Net worth by category (pure, unit-tested).
 *   Assets:      bank accounts · wallets & cash · money owed to you (lending)
 *   Liabilities: credit cards (owed now) · loans (outstanding principal) · other EMIs (remaining payments)
 *                · money you borrowed (lending)
 * Closed accounts and settled records don't count. A loan with a linked EMI payment counts once, as the
 * loan; EMI payments with no loan details count as their remaining payments (interest included).
 */
import { AccountRef, AccountSummary, refKey } from '../models/account.model';
import { LendingRecord, peopleFrom } from '../models/lending.model';
import { Loan, LOAN_KINDS, loanStatus } from '../models/loan.model';
import { RecurringPayment, paymentsLeft } from '../models/recurring.model';
import { FinanceTxn, balanceEffect } from './analytics.util';

export type WealthGroupId = 'bank' | 'wallet' | 'owed' | 'cards' | 'loans' | 'emis' | 'borrowed';

export interface WealthLine {
  id: string;
  label: string;
  sub: string;
  amount: number;
  icon: string;
  link: string | null;
}

export interface WealthGroup {
  id: WealthGroupId;
  label: string;
  icon: string;
  side: 'asset' | 'liability';
  total: number;
  lines: WealthLine[];
  note: string;
}

export interface NetWorth {
  assets: number;
  liabilities: number;
  net: number;
  groups: WealthGroup[];
  /** Liabilities as a share of assets (0–∞), null without assets. */
  debtRatio: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: { amount: number }[]) => r2(xs.reduce((s, x) => s + x.amount, 0));
const accLink = (r: AccountRef) => `/account/${r.type}/${r.id}`;

export function netWorth(accounts: AccountSummary[], lending: LendingRecord[], loans: Loan[], plans: RecurringPayment[], today = new Date()): NetWorth {
  const active = accounts.filter(a => a.status === 'Active');
  const bank = active.filter(a => a.type === 'bank').map(a => line(a.key, a.name, a.subtitle, a.balance, a.icon, accLink(a.ref)));
  const wallet = active.filter(a => a.type === 'wallet').map(a => line(a.key, a.name, a.subtitle, a.balance, a.icon, accLink(a.ref)));
  // A closed card that still has a balance is still owed.
  const cards = accounts.filter(a => a.type === 'card' && (a.status === 'Active' || a.balance > 0.004) && a.balance !== 0)
    .map(a => line(a.key, a.name, a.subtitle, a.balance, 'credit-card', accLink(a.ref)));

  const people = peopleFrom(lending, today);
  const owed = people.filter(p => p.owesMe > 0).map(p => line(`p:${p.key}`, p.name, `${p.open.filter(r => r.direction === 'lent').length} open`, p.owesMe, 'arrow-up-right', '/lending'));
  const borrowed = people.filter(p => p.iOwe > 0).map(p => line(`b:${p.key}`, p.name, 'borrowed', p.iOwe, 'arrow-down-left', '/lending'));

  const planById = new Map(plans.map(p => [p.id, p]));
  const linkedPlans = new Set(loans.map(l => l.recurringId).filter(Boolean) as string[]);
  const loanLines = loans
    .filter(l => l.status === 'active')
    .map(l => {
      const plan = l.recurringId ? planById.get(l.recurringId) ?? null : null;
      const s = loanStatus(l, plan, today);
      const kind = LOAN_KINDS.find(k => k.id === l.kind)!;
      return line(`loan:${l.id}`, l.name, [l.lender, s.invalid ? 'check the EMI' : `${s.paid}/${s.total} EMIs paid`].filter(Boolean).join(' · '), s.outstanding, kind.icon, '/wealth#loans');
    })
    .filter(x => x.amount > 0.004);
  const emis = plans
    .filter(p => !linkedPlans.has(p.id) && !p.completed && p.category === 'EMI')
    .map(p => {
      const left = paymentsLeft(p);
      return Number.isFinite(left) ? line(`emi:${p.id}`, p.description, `${left} payment${left === 1 ? '' : 's'} of ₹${p.amount.toLocaleString('en-IN')} left`, r2(p.amount * left), 'repeat', '/recurring') : null;
    })
    .filter((x): x is WealthLine => !!x && x.amount > 0.004);

  const groups: WealthGroup[] = [
    group('bank', 'Bank accounts', 'landmark', 'asset', bank, ''),
    group('wallet', 'Wallets & cash', 'wallet', 'asset', wallet, ''),
    group('owed', 'Owed to you', 'hand-coins', 'asset', owed, 'Money you lent that is still to come back.'),
    group('cards', 'Credit cards', 'credit-card', 'liability', cards, 'Billed and unbilled amounts owed now.'),
    group('loans', 'Loans', 'landmark', 'liability', loanLines, 'Principal still owed (future interest isn’t a debt yet).'),
    group('emis', 'Other EMIs', 'repeat', 'liability', emis, 'EMI payments without loan details: the remaining payments, interest included. Add loan details for the exact principal.'),
    group('borrowed', 'Borrowed', 'arrow-down-left', 'liability', borrowed, 'Money people lent you.'),
  ];
  const assets = r2(groups.filter(g => g.side === 'asset').reduce((s, g) => s + g.total, 0));
  const liabilities = r2(groups.filter(g => g.side === 'liability').reduce((s, g) => s + g.total, 0));
  return { assets, liabilities, net: r2(assets - liabilities), groups, debtRatio: assets > 0 ? liabilities / assets : null };
}

function line(id: string, label: string, sub: string, amount: number, icon: string, link: string | null): WealthLine {
  return { id, label, sub, amount: r2(amount), icon, link };
}
function group(id: WealthGroupId, label: string, icon: string, side: WealthGroup['side'], lines: WealthLine[], note: string): WealthGroup {
  return { id, label, icon, side, lines: [...lines].sort((a, b) => b.amount - a.amount), total: sum(lines), note };
}

/**
 * Bank + wallet balance at the end of each month (oldest first), worked back from today's balances:
 * balance at a month's end = balance now − everything that moved the account after that month ended.
 * `txns` must cover every month from the first one to today. The current month's point is today.
 */
export function cashHistory(accounts: AccountSummary[], txns: FinanceTxn[], months: string[], today = new Date()): { month: string; amount: number }[] {
  const refs = accounts.filter(a => a.status === 'Active' && (a.type === 'bank' || a.type === 'wallet')).map(a => a.ref);
  const keys = new Set(refs.map(refKey));
  const now = r2(accounts.filter(a => keys.has(a.key)).reduce((s, a) => s + a.balance, 0));
  const effect = (t: FinanceTxn) => refs.reduce((s, r) => s + balanceEffect(t, r), 0);
  const nowKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  return months.map(m => {
    if (m >= nowKey) return { month: m, amount: now };
    const [y, mo] = m.split('-').map(Number);
    const end = new Date(y, mo, 1); // first moment of the next month
    const after = txns.filter(t => t.date >= end && t.date <= today).reduce((s, t) => s + effect(t), 0);
    return { month: m, amount: r2(now - after) };
  });
}
