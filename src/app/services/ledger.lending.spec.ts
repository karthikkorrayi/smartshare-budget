import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { LedgerService } from './ledger.service';
import { ExpenseService } from './expense.service';
import { IncomeService } from './income.service';
import { CardTransactionsService } from './card-transactions.service';
import { WalletsService } from './wallets.service';
import { TransfersService } from './transfers.service';
import { UpcomingPaymentService } from './upcoming-payment.service';
import { ReceivableService } from './receivable.service';
import { lendingFrom } from '../models/lending.model';

/** In-memory stand-ins for the Firestore-backed services, recording what the ledger writes. */
function fakes() {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const db = {
    expenses: new Map<string, any>(),
    income: new Map<string, any>(),
    card: new Map<string, any>(),
    wallet: new Map<string, any>(),
    receivables: new Map<string, any>(),
  };
  const providers = [
    { provide: Firestore, useValue: {} },
    { provide: ExpenseService, useValue: {
      addExpense: async (d: any) => { const k = id('e'); db.expenses.set(k, { ...d }); return { id: k }; },
      updateExpense: async ({ id: k, ...ch }: any) => { db.expenses.set(k, { ...db.expenses.get(k), ...ch }); },
      deleteExpense: async (k: string) => { db.expenses.delete(k); },
    } },
    { provide: IncomeService, useValue: { addIncome: async (d: any) => { const k = id('i'); db.income.set(k, d); return { id: k }; } } },
    { provide: CardTransactionsService, useValue: {
      add: async (d: any) => { const k = id('c'); db.card.set(k, d); return { id: k }; },
      delete: async (k: string) => { db.card.delete(k); },
    } },
    { provide: WalletsService, useValue: {
      addTxn: async (d: any) => { const k = id('w'); db.wallet.set(k, d); return { id: k }; },
      deleteTxn: async (k: string) => { db.wallet.delete(k); },
    } },
    { provide: TransfersService, useValue: {} },
    { provide: UpcomingPaymentService, useValue: {} },
    { provide: ReceivableService, useValue: {
      add: async (d: any) => { const k = id('r'); db.receivables.set(k, { ...d }); return { id: k }; },
      update: async (k: string, ch: any) => { db.receivables.set(k, { ...db.receivables.get(k), ...ch }); },
      delete: async (k: string) => { db.receivables.delete(k); },
    } },
  ];
  return { db, providers };
}

const day = new Date(2026, 10, 24, 12);
const bank = { type: 'bank' as const, id: 'b1' };
const sum = (m: Map<string, any>) => Math.round([...m.values()].reduce((s, x) => s + x.amount, 0) * 100) / 100;

describe('LedgerService — lending and splits', () => {
  let ledger: LedgerService;
  let db: ReturnType<typeof fakes>['db'];

  beforeEach(() => {
    const f = fakes();
    db = f.db;
    TestBed.configureTestingModule({ providers: f.providers });
    ledger = TestBed.inject(LedgerService);
  });

  it('a split books your share in its category and each other share as Lent — totals match what you paid', async () => {
    const s = await ledger.recordSplit(bank, { description: 'Dinner', amount: 1000, category: 'Food', date: day }, {
      me: 333.34, dueDate: null,
      people: [{ name: 'Priya', phone: '98765 43210', share: 333.33 }, { name: 'Anil', share: 333.33 }],
    });
    const exp = [...db.expenses.values()];
    expect(exp.filter(e => e.category === 'Food').map(e => e.amount)).toEqual([333.34]);
    expect(exp.filter(e => e.category === 'Lent').length).toBe(2);
    expect(sum(db.expenses)).toBe(1000); // the account drops by exactly what was paid
    expect(exp.every(e => e.accountType === 'bank' && e.accountId === 'b1')).toBeTrue();
    const recs = [...db.receivables.values()];
    expect(recs.length).toBe(2);
    expect(recs[0].phone).toBe('919876543210');
    expect(recs.every(r => r.trackInExpenses && r.splitTotal === 1000 && r.splitCount === 3 && r.splitOwnShare === 333.34)).toBeTrue();
    expect(recs.every(r => db.expenses.has(r.lentExpenseId) && r.lentKey === 'expense:' + r.lentExpenseId)).toBeTrue();
    await s.undo();
    expect(db.expenses.size).toBe(0);
    expect(db.receivables.size).toBe(0);
  });

  it('without you in the split, the whole amount is Lent; on a card the Lent category is kept', async () => {
    await ledger.recordSplit({ type: 'card', id: 'c9' }, { description: 'Cab', amount: 600, category: 'Travel', date: day }, {
      me: 0, dueDate: null, people: [{ name: 'A', share: 300 }, { name: 'B', share: 300 }],
    });
    expect(db.expenses.size).toBe(0);
    expect([...db.card.values()].map(c => c.category)).toEqual(['Lent', 'Lent']);
    expect([...db.receivables.values()].every(r => r.lentKey.startsWith('card:') && !r.lentExpenseId && !r.splitOwnKey)).toBeTrue();
  });

  it('rejects shares that don’t add up, writing nothing', async () => {
    await expectAsync(ledger.recordSplit(bank, { description: 'X', amount: 1000, category: 'Food', date: day }, {
      me: 100, dueDate: null, people: [{ name: 'A', share: 300 }],
    })).toBeRejected();
    expect(db.expenses.size + db.receivables.size).toBe(0);
  });

  it('partial repayment → income; forgiving the rest closes it without more income', async () => {
    await ledger.addLending({ direction: 'lent', person: 'Rahul', amount: 1000, date: day, dueDate: null, track: true, account: bank, notes: '' });
    const [rid, raw] = [...db.receivables.entries()][0];
    let r = lendingFrom({ id: rid, ...raw });
    await ledger.settleLending(r, 400, bank, day);
    expect(sum(db.income)).toBe(400);
    r = lendingFrom({ id: rid, ...db.receivables.get(rid) });
    expect(r.outstanding).toBe(600);
    await ledger.settleLending(r, 100, bank, day, true);
    r = lendingFrom({ id: rid, ...db.receivables.get(rid) });
    expect(sum(db.income)).toBe(500);
    expect(r.status).toBe('PAID');
    expect(r.waived).toBe(500);
    expect(r.settled).toBe(500);
  });

  it('borrowed and note-only loans never create spending or income', async () => {
    await ledger.addLending({ direction: 'borrowed', person: 'Sam', amount: 800, date: day, dueDate: null, track: true, account: bank, notes: '' });
    await ledger.addLending({ direction: 'lent', person: 'Kim', amount: 500, date: day, dueDate: null, track: false, account: bank, notes: '' });
    for (const [rid, raw] of db.receivables) await ledger.settleLending(lendingFrom({ id: rid, ...raw }), raw.amount, bank, day);
    expect(db.expenses.size).toBe(0);
    expect(db.income.size).toBe(0);
    expect([...db.receivables.values()].every(r => r.status === 'PAID')).toBeTrue();
  });

  it('deleting an open loan removes its Lent entry; deleting a split removes every part', async () => {
    await ledger.addLending({ direction: 'lent', person: 'W', amount: 200, date: day, dueDate: null, track: true, account: { type: 'wallet', id: 'w1' }, notes: '' });
    const [rid, raw] = [...db.receivables.entries()][0];
    expect(db.wallet.size).toBe(1);
    await ledger.deleteLending(lendingFrom({ id: rid, ...raw }));
    expect(db.wallet.size).toBe(0);
    expect(db.receivables.size).toBe(0);

    await ledger.recordSplit(bank, { description: 'Trip', amount: 900, category: 'Travel', date: day }, {
      me: 300, dueDate: null, people: [{ name: 'A', share: 300 }, { name: 'B', share: 300 }],
    });
    const members = [...db.receivables.entries()].map(([id, d]) => lendingFrom({ id, ...d }));
    await ledger.deleteSplit(members);
    expect(db.expenses.size).toBe(0);
    expect(db.receivables.size).toBe(0);
  });

  it('a partly repaid loan keeps its Lent entry when deleted (no invented income); a repaid split can’t be deleted', async () => {
    await ledger.addLending({ direction: 'lent', person: 'P', amount: 1000, date: day, dueDate: null, track: true, account: bank, notes: '' });
    const [rid, raw] = [...db.receivables.entries()][0];
    await ledger.settleLending(lendingFrom({ id: rid, ...raw }), 400, bank, day);
    await ledger.deleteLending(lendingFrom({ id: rid, ...db.receivables.get(rid) }));
    expect(sum(db.expenses)).toBe(1000);
    expect(sum(db.income)).toBe(400);

    await ledger.recordSplit(bank, { description: 'Trip', amount: 600, category: 'Travel', date: day }, { me: 300, dueDate: null, people: [{ name: 'A', share: 300 }] });
    const [sid, sraw] = [...db.receivables.entries()].find(([, d]) => d.splitId)!;
    await ledger.settleLending(lendingFrom({ id: sid, ...sraw }), 100, bank, day);
    await expectAsync(ledger.deleteSplit([lendingFrom({ id: sid, ...db.receivables.get(sid) })])).toBeRejected();
  });
});
