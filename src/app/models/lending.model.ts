/**
 * receivables/{id} — the lending / borrowing ledger.
 *
 * Existing documents are money YOU LENT (title = who, amount, status PENDING|PAID, trackInExpenses,
 * lentExpenseId, paidDate). Optional fields:
 *   direction      'lent' (default) | 'borrowed'
 *   date           when the money changed hands (falls back to createdAt)
 *   dueDate        expected repayment date
 *   settledAmount  repaid so far (partial repayments); PAID once nothing is outstanding
 *   notes
 *   accountType / accountId  account the money left from (lent) — bank, wallet or card (Phase 4)
 *   history        [{ date, amount }] repayments
 * Phase 4 (all optional):
 *   phone          contact number for WhatsApp / call (digits, country code included, e.g. 919876543210)
 *   lentKey        the "Lent" entry booked for a tracked loan: 'expense:<id>' | 'card:<id>' | 'wallet:<id>'
 *                  (older loans have lentExpenseId — a bank / no-account expense)
 *   waivedAmount   part you decided not to collect ("forgive the rest"); counts as closed, never as income
 *   splitId / splitTitle / splitTotal / splitCount / splitOwnShare / splitOwnKey
 *                  set on each person's record when it came from "Split this amount"
 *
 * Budget effect (unchanged rules): a TRACKED loan you give is a "Lent" expense on the day you give it,
 * and each repayment is income ("Repayment") on the day it's received. Borrowed money is ledger-only —
 * borrowing is not income and repaying it is not spending. A split books YOUR share in the expense's
 * own category and each other person's share as a separate "Lent" entry, so the category totals show
 * only what you spent and nothing is counted twice.
 */
import { AccountRef } from './account.model';
import { daysBetween, monthKey, startOfDay } from '../utils/date-input.util';
import { toDate } from '../utils/firestore.util';

export type LendDirection = 'lent' | 'borrowed';

export interface SplitInfo {
  id: string;
  title: string;
  total: number;
  /** People in the split, you included when you had a share. */
  count: number;
  ownShare: number;
  /** Your own share's entry ('expense:<id>' …), when you had one. */
  ownKey: string | null;
}

export interface LendingRecord {
  id: string;
  direction: LendDirection;
  person: string;
  phone: string;
  amount: number;
  /** Money actually repaid. */
  settled: number;
  /** Forgiven (not collected). */
  waived: number;
  outstanding: number;
  status: 'PENDING' | 'PAID';
  date: Date | null;
  dueDate: Date | null;
  trackInExpenses: boolean;
  account: AccountRef | null;
  /** The tracked "Lent" entry, if any. */
  lentKey: string | null;
  notes: string;
  history: { date: Date; amount: number }[];
  paidDate: Date | null;
  split: SplitInfo | null;
  raw: any;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function lendingFrom(d: any): LendingRecord {
  const amount = Number(d.amount) || 0;
  const status = d.status === 'PAID' ? 'PAID' : 'PENDING';
  const waived = Math.min(amount, Math.max(0, Number(d.waivedAmount) || 0));
  // Old PAID records have no settledAmount: they were repaid in full.
  const settledRaw = status === 'PAID' && !(waived > 0) ? amount : Number(d.settledAmount) || 0;
  const settled = Math.min(amount - waived, Math.max(0, settledRaw));
  const accType = d.accountType === 'bank' || d.accountType === 'wallet' || d.accountType === 'card' ? d.accountType : null;
  return {
    id: d.id,
    direction: d.direction === 'borrowed' ? 'borrowed' : 'lent',
    person: d.title ?? 'Someone',
    phone: normalizePhone(d.phone),
    amount,
    settled: r2(settled),
    waived: r2(waived),
    outstanding: status === 'PAID' ? 0 : Math.max(0, r2(amount - settled - waived)),
    status,
    date: toDate(d.date) ?? toDate(d.createdAt),
    dueDate: toDate(d.dueDate),
    trackInExpenses: !!d.trackInExpenses,
    account: accType && d.accountId ? { type: accType, id: d.accountId } : null,
    lentKey: typeof d.lentKey === 'string' && /^(expense|card|wallet):.+/.test(d.lentKey) ? d.lentKey : d.lentExpenseId ? `expense:${d.lentExpenseId}` : null,
    notes: d.notes ?? '',
    history: (Array.isArray(d.history) ? d.history : []).map((h: any) => ({ date: toDate(h?.date) ?? new Date(0), amount: Number(h?.amount) || 0 })),
    paidDate: toDate(d.paidDate),
    split: d.splitId
      ? {
          id: String(d.splitId),
          title: d.splitTitle ?? 'Split',
          total: Number(d.splitTotal) || amount,
          count: Math.max(1, Number(d.splitCount) || 1),
          ownShare: Number(d.splitOwnShare) || 0,
          ownKey: typeof d.splitOwnKey === 'string' ? d.splitOwnKey : null,
        }
      : null,
    raw: d,
  };
}

export function lendingDue(r: LendingRecord, today = new Date()): { tone: 'ok' | 'soon' | 'overdue' | 'none'; text: string } {
  if (r.status === 'PAID') return { tone: 'ok', text: r.waived > 0 && r.settled < r.amount ? 'Closed' : 'Settled' };
  if (!r.dueDate) return { tone: 'none', text: 'No due date' };
  const days = daysBetween(today, r.dueDate);
  if (days < 0) return { tone: 'overdue', text: `${-days} day${days === -1 ? '' : 's'} past due` };
  if (days === 0) return { tone: 'soon', text: 'Due today' };
  if (days <= 7) return { tone: 'soon', text: `Due in ${days} day${days === 1 ? '' : 's'}` };
  return { tone: 'ok', text: `Due ${r.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` };
}

// ── Contact ──────────────────────────────────────────────────────

/**
 * Digits with the country code, or '' when it isn't a usable number.
 * 98765 43210 / 098765-43210 / +91 98765 43210 → 919876543210 (India is the default country).
 */
export function normalizePhone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

/** "+91 98765 43210" for display. */
export function displayPhone(p: string): string {
  if (!p) return '';
  if (p.startsWith('91') && p.length === 12) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
  return `+${p}`;
}

/** WhatsApp chat with the message typed in. Without a number WhatsApp asks which chat to send it to. */
export function whatsappLink(phone: string, text: string): string {
  const t = encodeURIComponent(text);
  return phone ? `https://wa.me/${phone}?text=${t}` : `https://wa.me/?text=${t}`;
}

export function callLink(phone: string): string {
  return phone ? `tel:+${phone}` : '';
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const shortDate = (d: Date | null) => (d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

/** A friendly reminder for one or more open records with the same person. */
export function reminderText(records: LendingRecord[]): string {
  const open = records.filter(r => r.status === 'PENDING' && r.outstanding > 0);
  if (!open.length) return '';
  const first = open[0].person.split(/\s+/)[0];
  const lent = open.filter(r => r.direction === 'lent');
  const borrowed = open.filter(r => r.direction === 'borrowed');
  const what = (r: LendingRecord) => `${rupees(r.outstanding)}${r.split ? ` for ${r.split.title}` : r.notes ? ` for ${r.notes.slice(0, 40)}` : ''}${r.date ? ` (${shortDate(r.date)})` : ''}`;
  if (lent.length && !borrowed.length) {
    const total = r2(lent.reduce((s, r) => s + r.outstanding, 0));
    if (lent.length === 1) return `Hi ${first}, a gentle reminder — ${what(lent[0])} is still pending. Thanks!`;
    return `Hi ${first}, a gentle reminder — ${rupees(total)} is pending:\n${lent.map(r => `• ${what(r)}`).join('\n')}\nThanks!`;
  }
  if (borrowed.length && !lent.length) {
    const total = r2(borrowed.reduce((s, r) => s + r.outstanding, 0));
    return `Hi ${first}, about the ${rupees(total)} I owe you — `;
  }
  const owedToMe = r2(lent.reduce((s, r) => s + r.outstanding, 0));
  const iOwe = r2(borrowed.reduce((s, r) => s + r.outstanding, 0));
  const net = r2(owedToMe - iOwe);
  return net > 0
    ? `Hi ${first}, settling up: you owe me ${rupees(owedToMe)} and I owe you ${rupees(iOwe)}, so ${rupees(net)} to me. Thanks!`
    : `Hi ${first}, settling up: I owe you ${rupees(iOwe)} and you owe me ${rupees(owedToMe)}, so ${rupees(-net)} to you.`;
}

// ── Splitting ────────────────────────────────────────────────────

export type SplitMethod = 'equal' | 'exact';
export interface SplitPerson {
  name: string;
  phone?: string;
  /** Exact method only. */
  amount?: number | null;
}
export interface SplitResult {
  /** Your share (0 when you aren't in the split). */
  me: number;
  /** One per person, same order as given. */
  shares: number[];
  error: string;
}

/**
 * Shares of `total`. Equal: everyone gets the same to the paisa; the paise left over go to you
 * (you paid), or one paisa each to the first people when you aren't in the split.
 * Exact: each person's amount as entered; your share is what's left (must not be negative), or —
 * without you — the amounts must add up to the total.
 */
export function splitShares(total: number, people: SplitPerson[], includeMe: boolean, method: SplitMethod): SplitResult {
  const T = Math.round((Number(total) || 0) * 100);
  const n = people.length;
  if (!(T > 0)) return { me: 0, shares: people.map(() => 0), error: 'Enter the amount first.' };
  if (!n) return { me: r2(T / 100), shares: [], error: 'Add at least one person to split with.' };
  if (method === 'equal') {
    const parts = n + (includeMe ? 1 : 0);
    const base = Math.floor(T / parts);
    let rest = T - base * parts;
    const shares = people.map(() => base);
    let me = includeMe ? base : 0;
    if (includeMe) me += rest;
    else for (let i = 0; rest > 0; i = (i + 1) % n, rest--) shares[i]++;
    return { me: me / 100, shares: shares.map(s => s / 100), error: base > 0 ? '' : 'The amount is too small to split that many ways.' };
  }
  const cents = people.map(p => Math.round((Number(p.amount) || 0) * 100));
  const sum = cents.reduce((s, c) => s + c, 0);
  const shares = cents.map(c => c / 100);
  if (cents.some(c => !(c > 0))) return { me: includeMe ? Math.max(0, T - sum) / 100 : 0, shares, error: 'Enter an amount for every person.' };
  if (includeMe) {
    if (sum > T) return { me: 0, shares, error: `The shares add up to ${rupees((sum - T) / 100)} more than the total.` };
    return { me: (T - sum) / 100, shares, error: '' };
  }
  if (sum !== T) {
    const diff = (T - sum) / 100;
    return { me: 0, shares, error: diff > 0 ? `${rupees(diff)} of the total isn't assigned to anyone.` : `The shares add up to ${rupees(-diff)} more than the total.` };
  }
  return { me: 0, shares, error: '' };
}

// ── Views ────────────────────────────────────────────────────────

/** Records of the same person are grouped by phone number when there is one, else by name. */
export const personKey = (r: Pick<LendingRecord, 'person' | 'phone'>) => (r.phone ? `p:${r.phone}` : `n:${r.person.trim().toLowerCase().replace(/\s+/g, ' ')}`);

export interface PersonSummary {
  key: string;
  name: string;
  phone: string;
  /** Still to receive from them. */
  owesMe: number;
  /** Still to pay them. */
  iOwe: number;
  /** owesMe − iOwe. */
  net: number;
  open: LendingRecord[];
  closed: LendingRecord[];
  overdue: boolean;
  nextDue: Date | null;
  lastActivity: Date | null;
}

export function peopleFrom(records: LendingRecord[], today = new Date()): PersonSummary[] {
  const map = new Map<string, PersonSummary>();
  // Records without a phone join the person with the same name who has one.
  const phoneByName = new Map<string, string>();
  for (const r of records) if (r.phone) phoneByName.set(r.person.trim().toLowerCase(), r.phone);
  for (const r of records) {
    const phone = r.phone || phoneByName.get(r.person.trim().toLowerCase()) || '';
    const key = personKey({ person: r.person, phone });
    let p = map.get(key);
    if (!p) {
      p = { key, name: r.person.trim(), phone, owesMe: 0, iOwe: 0, net: 0, open: [], closed: [], overdue: false, nextDue: null, lastActivity: null };
      map.set(key, p);
    }
    const last = [r.date, r.paidDate, ...r.history.map(h => h.date)].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    if (last && (!p.lastActivity || last > p.lastActivity)) p.lastActivity = last;
    if (r.status === 'PAID') { p.closed.push(r); continue; }
    p.open.push(r);
    if (r.direction === 'lent') p.owesMe += r.outstanding; else p.iOwe += r.outstanding;
    if (r.dueDate) {
      if (daysBetween(today, r.dueDate) < 0) p.overdue = true;
      if (!p.nextDue || r.dueDate < p.nextDue) p.nextDue = r.dueDate;
    }
  }
  const out = [...map.values()].map(p => ({ ...p, owesMe: r2(p.owesMe), iOwe: r2(p.iOwe), net: r2(p.owesMe - p.iOwe) }));
  // Open balances first (overdue, then largest), then everyone else by recent activity.
  return out.sort((a, b) =>
    Number(b.open.length > 0) - Number(a.open.length > 0) ||
    Number(b.overdue) - Number(a.overdue) ||
    Math.abs(b.net) - Math.abs(a.net) ||
    (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0)
  );
}

export interface SplitGroup {
  id: string;
  title: string;
  date: Date | null;
  total: number;
  ownShare: number;
  count: number;
  members: LendingRecord[];
  /** Others' shares. */
  owed: number;
  collected: number;
  outstanding: number;
  paidCount: number;
  done: boolean;
}

export function splitsFrom(records: LendingRecord[]): SplitGroup[] {
  const map = new Map<string, SplitGroup>();
  for (const r of records) {
    if (!r.split) continue;
    let g = map.get(r.split.id);
    if (!g) {
      g = { id: r.split.id, title: r.split.title, date: r.date, total: r.split.total, ownShare: r.split.ownShare, count: r.split.count, members: [], owed: 0, collected: 0, outstanding: 0, paidCount: 0, done: false };
      map.set(r.split.id, g);
    }
    g.members.push(r);
    g.owed += r.amount;
    g.collected += r.settled;
    g.outstanding += r.outstanding;
    if (r.status === 'PAID') g.paidCount++;
  }
  return [...map.values()]
    .map(g => ({ ...g, owed: r2(g.owed), collected: r2(g.collected), outstanding: r2(g.outstanding), done: g.paidCount === g.members.length }))
    .sort((a, b) => Number(a.done) - Number(b.done) || (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

export interface LendingStats {
  owedToMe: number;
  iOwe: number;
  openCount: number;
  overdueCount: number;
  /** Repayments received this month (all loans). */
  receivedThisMonth: number;
  /** Tracked money lent this month — already in this month's spending as "Lent". */
  lentSpendThisMonth: number;
  /** Tracked repayments this month — already in this month's income as "Repayment". */
  repaymentIncomeThisMonth: number;
  /** All-time share of lent money that came back (repaid ÷ (lent − forgiven)), 0–100. */
  collectionRate: number;
  forgiven: number;
}

export function lendingStats(records: LendingRecord[], today = new Date()): LendingStats {
  const month = monthKey(today);
  const t0 = startOfDay(today).getTime();
  let owedToMe = 0, iOwe = 0, openCount = 0, overdueCount = 0, receivedThisMonth = 0, lentSpend = 0, repayIncome = 0;
  let lentTotal = 0, repaidTotal = 0, forgiven = 0;
  for (const r of records) {
    if (r.status === 'PENDING') {
      openCount++;
      if (r.direction === 'lent') owedToMe += r.outstanding; else iOwe += r.outstanding;
      if (r.dueDate && startOfDay(r.dueDate).getTime() < t0) overdueCount++;
    }
    if (r.direction !== 'lent') continue;
    lentTotal += r.amount;
    repaidTotal += r.settled;
    forgiven += r.waived;
    if (r.trackInExpenses && r.date && monthKey(r.date) === month) lentSpend += r.amount;
    for (const h of r.history) {
      if (monthKey(h.date) !== month) continue;
      receivedThisMonth += h.amount;
      if (r.trackInExpenses) repayIncome += h.amount;
    }
  }
  const collectable = lentTotal - forgiven;
  return {
    owedToMe: r2(owedToMe),
    iOwe: r2(iOwe),
    openCount,
    overdueCount,
    receivedThisMonth: r2(receivedThisMonth),
    lentSpendThisMonth: r2(lentSpend),
    repaymentIncomeThisMonth: r2(repayIncome),
    collectionRate: collectable > 0 ? Math.round((repaidTotal / collectable) * 100) : 0,
    forgiven: r2(forgiven),
  };
}

/** Names (and numbers) already used, for suggestions when adding people. */
export function knownContacts(records: LendingRecord[]): { name: string; phone: string }[] {
  const seen = new Map<string, { name: string; phone: string; t: number }>();
  for (const r of records) {
    const k = r.person.trim().toLowerCase();
    const t = r.date?.getTime() ?? 0;
    const cur = seen.get(k);
    if (!cur || (r.phone && !cur.phone) || (t > cur.t && (r.phone || !cur.phone))) seen.set(k, { name: r.person.trim(), phone: r.phone || cur?.phone || '', t: Math.max(t, cur?.t ?? 0) });
  }
  return [...seen.values()].sort((a, b) => b.t - a.t).map(({ name, phone }) => ({ name, phone }));
}
