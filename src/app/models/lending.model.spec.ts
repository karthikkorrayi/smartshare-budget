import {
  callLink,
  displayPhone,
  knownContacts,
  lendingFrom,
  lendingStats,
  normalizePhone,
  peopleFrom,
  reminderText,
  splitShares,
  splitsFrom,
  whatsappLink,
} from './lending.model';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);
const rec = (o: any) => lendingFrom({ id: o.id ?? Math.random().toString(36).slice(2), title: 'Rahul', amount: 1000, status: 'PENDING', ...o });

describe('lending model — reading records', () => {
  it('old PAID records count as fully repaid; partial repayments and forgiven amounts are separate', () => {
    expect(rec({ status: 'PAID' }).settled).toBe(1000);
    const part = rec({ settledAmount: 400 });
    expect(part.outstanding).toBe(600);
    const closed = rec({ status: 'PAID', settledAmount: 700, waivedAmount: 300 });
    expect(closed.settled).toBe(700);
    expect(closed.waived).toBe(300);
    expect(closed.outstanding).toBe(0);
  });

  it('links the tracked Lent entry from lentKey or the older lentExpenseId', () => {
    expect(rec({ lentKey: 'card:c9' }).lentKey).toBe('card:c9');
    expect(rec({ lentExpenseId: 'e1' }).lentKey).toBe('expense:e1');
    expect(rec({}).lentKey).toBeNull();
  });

  it('reads split details', () => {
    const r = rec({ splitId: 's1', splitTitle: 'Dinner', splitTotal: 1200, splitCount: 4, splitOwnShare: 300, splitOwnKey: 'expense:x' });
    expect(r.split).toEqual({ id: 's1', title: 'Dinner', total: 1200, count: 4, ownShare: 300, ownKey: 'expense:x' });
  });
});

describe('lending model — phone and links', () => {
  it('normalises Indian numbers and rejects short ones', () => {
    expect(normalizePhone('98765 43210')).toBe('919876543210');
    expect(normalizePhone('098765-43210')).toBe('919876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('919876543210');
    expect(normalizePhone('0044 7700 900123')).toBe('447700900123');
    expect(normalizePhone('12345')).toBe('');
    expect(displayPhone('919876543210')).toBe('+91 98765 43210');
  });

  it('builds WhatsApp and call links', () => {
    expect(whatsappLink('919876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye');
    expect(whatsappLink('', 'Hi')).toBe('https://wa.me/?text=Hi');
    expect(callLink('919876543210')).toBe('tel:+919876543210');
    expect(callLink('')).toBe('');
  });

  it('writes a reminder for one or several records, and nets both directions', () => {
    const one = reminderText([rec({ amount: 300, splitId: 's', splitTitle: 'Dinner', date: d(2026, 11, 24) })]);
    expect(one).toContain('₹300 for Dinner (24 Nov)');
    const two = reminderText([rec({ amount: 300 }), rec({ amount: 200 })]);
    expect(two).toContain('₹500 is pending');
    const net = reminderText([rec({ amount: 500 }), rec({ amount: 200, direction: 'borrowed' })]);
    expect(net).toContain('₹300 to me');
    expect(reminderText([rec({ status: 'PAID' })])).toBe('');
  });
});

describe('lending model — splitShares', () => {
  const ppl = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));

  it('equal with me: everyone the same, leftover paise to me, total preserved', () => {
    const s = splitShares(1000, ppl(2), true, 'equal');
    expect(s.shares).toEqual([333.33, 333.33]);
    expect(s.me).toBe(333.34);
    expect(Math.round((s.me + s.shares.reduce((a, b) => a + b, 0)) * 100)).toBe(100000);
  });

  it('equal without me: leftover paise go to the first people', () => {
    const s = splitShares(100, ppl(3), false, 'equal');
    expect(s.me).toBe(0);
    expect(s.shares).toEqual([33.34, 33.33, 33.33]);
  });

  it('exact: my share is the rest; without me the amounts must add up', () => {
    expect(splitShares(1200, [{ name: 'A', amount: 500 }, { name: 'B', amount: 300 }], true, 'exact')).toEqual({ me: 400, shares: [500, 300], error: '' });
    expect(splitShares(1200, [{ name: 'A', amount: 1000 }, { name: 'B', amount: 300 }], true, 'exact').error).toContain('more than the total');
    expect(splitShares(1200, [{ name: 'A', amount: 500 }, { name: 'B', amount: 300 }], false, 'exact').error).toContain('isn\'t assigned');
    expect(splitShares(800, [{ name: 'A', amount: 500 }, { name: 'B', amount: 300 }], false, 'exact').error).toBe('');
    expect(splitShares(800, [{ name: 'A', amount: 500 }, { name: 'B', amount: null }], true, 'exact').error).toContain('every person');
  });

  it('asks for an amount and at least one person', () => {
    expect(splitShares(0, ppl(1), true, 'equal').error).toContain('amount');
    expect(splitShares(100, [], true, 'equal').error).toContain('person');
  });
});

describe('lending model — people, splits and stats', () => {
  const today = d(2026, 11, 24);
  const list = [
    rec({ id: '1', title: 'Rahul', amount: 500, phone: '9876543210', dueDate: d(2026, 11, 20), date: d(2026, 11, 1) }),
    rec({ id: '2', title: 'rahul ', amount: 200, direction: 'borrowed', date: d(2026, 11, 2) }),
    rec({ id: '3', title: 'Priya', amount: 300, splitId: 's1', splitTitle: 'Dinner', splitTotal: 1200, splitCount: 4, splitOwnShare: 300, trackInExpenses: true, date: d(2026, 11, 24),
      settledAmount: 100, history: [{ date: d(2026, 11, 24), amount: 100 }] }),
    rec({ id: '4', title: 'Anil', amount: 300, splitId: 's1', splitTitle: 'Dinner', splitTotal: 1200, splitCount: 4, splitOwnShare: 300, trackInExpenses: true, date: d(2026, 11, 24),
      status: 'PAID', settledAmount: 300, history: [{ date: d(2026, 11, 24), amount: 300 }] }),
    rec({ id: '5', title: 'Old', amount: 1000, status: 'PAID', trackInExpenses: true, date: d(2026, 9, 1), waivedAmount: 400, settledAmount: 600 }),
  ];

  it('groups a person by phone or name and nets what each side owes', () => {
    const people = peopleFrom(list, today);
    const rahul = people.find(p => p.name === 'Rahul')!;
    expect(rahul.open.length).toBe(2);
    expect(rahul.owesMe).toBe(500);
    expect(rahul.iOwe).toBe(200);
    expect(rahul.net).toBe(300);
    expect(rahul.overdue).toBeTrue();
    expect(people[0].name).toBe('Rahul'); // overdue first
  });

  it('collects a split with its members and progress', () => {
    const [g] = splitsFrom(list);
    expect(g.title).toBe('Dinner');
    expect(g.members.length).toBe(2);
    expect(g.owed).toBe(600);
    expect(g.collected).toBe(400);
    expect(g.outstanding).toBe(200);
    expect(g.paidCount).toBe(1);
    expect(g.done).toBeFalse();
  });

  it('stats: budget effect this month and collection rate exclude forgiven money', () => {
    const s = lendingStats(list, today);
    expect(s.owedToMe).toBe(700);
    expect(s.iOwe).toBe(200);
    expect(s.overdueCount).toBe(1);
    expect(s.lentSpendThisMonth).toBe(600);
    expect(s.repaymentIncomeThisMonth).toBe(400);
    expect(s.receivedThisMonth).toBe(400);
    expect(s.forgiven).toBe(400);
    // repaid 100 + 300 + 600 = 1000 of (500 + 300 + 300 + 1000 − 400) = 1700
    expect(s.collectionRate).toBe(59);
  });

  it('suggests known contacts, keeping a phone number when any record has one', () => {
    const c = knownContacts(list);
    expect(c.find(x => x.name.toLowerCase() === 'rahul')!.phone).toBe('919876543210');
  });
});
