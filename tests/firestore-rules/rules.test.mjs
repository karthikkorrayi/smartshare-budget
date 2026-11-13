// Firestore security-rules tests (Task 2.4 checkpoint).
// Run with:  npm run test:rules   (starts the Firestore emulator, runs these, stops it)
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp, addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
  writeBatch,
} from 'firebase/firestore';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
// Generic owner-only collections. Card-module collections have schema validation and their own suites below.
const OWNED = ['expenses', 'income', 'receivables', 'upcoming_payments', 'categories'];

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-smartshare-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

// Default test identity: a verified @gmail.com account (what the rules require).
const as = (uid, token) =>
  (uid
    ? env.authenticatedContext(uid, token ?? { email: `${uid}@gmail.com`, email_verified: true })
    : env.unauthenticatedContext()
  ).firestore();

async function seed(path, data) {
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), data));
}

for (const col of OWNED) {
  describe(`${col}`, () => {
    test('signed-out user cannot read or write', async () => {
      await seed(`${col}/a1`, { userId: ALICE, amount: 1 });
      await assertFails(getDoc(doc(as(null), `${col}/a1`)));
      await assertFails(addDoc(collection(as(null), col), { userId: ALICE }));
    });

    test('owner can create, read, query, update, delete', async () => {
      const db = as(ALICE);
      const ref = await assertSucceeds(addDoc(collection(db, col), { userId: ALICE, amount: 5 }));
      await assertSucceeds(getDoc(ref));
      await assertSucceeds(getDocs(query(collection(db, col), where('userId', '==', ALICE))));
      await assertSucceeds(updateDoc(ref, { amount: 6 }));
      await assertSucceeds(deleteDoc(ref));
    });

    test('cannot create a doc stamped with someone else\'s uid, or with no uid', async () => {
      await assertFails(addDoc(collection(as(ALICE), col), { userId: BOB }));
      await assertFails(addDoc(collection(as(ALICE), col), { amount: 1 }));
    });

    test('cannot read, update or delete another user\'s doc', async () => {
      await seed(`${col}/b1`, { userId: BOB, amount: 9 });
      const db = as(ALICE);
      await assertFails(getDoc(doc(db, `${col}/b1`)));
      await assertFails(updateDoc(doc(db, `${col}/b1`), { amount: 0 }));
      await assertFails(deleteDoc(doc(db, `${col}/b1`)));
    });

    test('cannot transfer ownership via update', async () => {
      await seed(`${col}/a2`, { userId: ALICE, amount: 1 });
      await assertFails(updateDoc(doc(as(ALICE), `${col}/a2`), { userId: BOB }));
    });

    test('unscoped list query is rejected (must filter by userId)', async () => {
      await seed(`${col}/a3`, { userId: ALICE });
      await assertFails(getDocs(collection(as(ALICE), col)));
      await assertFails(getDocs(query(collection(as(ALICE), col), where('userId', '==', BOB))));
    });
  });
}

describe('users/{uid}', () => {
  test('owner can create and read own profile', async () => {
    const db = as(ALICE);
    await assertSucceeds(setDoc(doc(db, `users/${ALICE}`), { uid: ALICE, email: 'a@x.com' }));
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}`)));
  });
  test('cannot read, write or list other profiles', async () => {
    await seed(`users/${BOB}`, { uid: BOB });
    const db = as(ALICE);
    await assertFails(getDoc(doc(db, `users/${BOB}`)));
    await assertFails(setDoc(doc(db, `users/${BOB}`), { uid: BOB }));
    await assertFails(getDocs(collection(db, 'users')));
  });
  test('profile uid field must match document id', async () => {
    await assertFails(setDoc(doc(as(ALICE), `users/${ALICE}`), { uid: BOB }));
  });
});

describe('metadata/{uid}', () => {
  test('owner only', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), `metadata/${ALICE}`), { processedMonths: {} }));
    await assertFails(getDoc(doc(as(BOB), `metadata/${ALICE}`)));
    await assertFails(setDoc(doc(as(BOB), `metadata/${ALICE}`), { processedMonths: {} }));
  });
});

describe('email_sync_logs and unknown collections', () => {
  test('client has no access to email_sync_logs', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'email_sync_logs')));
    await assertFails(addDoc(collection(as(ALICE), 'email_sync_logs'), { userId: ALICE }));
  });
  test('unlisted collections are denied by default', async () => {
    await assertFails(addDoc(collection(as(ALICE), 'random_stuff'), { userId: ALICE }));
  });
});


// ════════════════════════════════════════════════════════════════
// Credit card module: cards, card_transactions, card_statements,
// review_items, notifications
// ════════════════════════════════════════════════════════════════
const T = d => Timestamp.fromDate(new Date(d));

const newCard = (uid, o = {}) => ({
  userId: uid,
  cardholderName: 'K KORRAYI',
  bankName: 'HDFC Bank',
  nickname: 'Millennia',
  lastFourDigits: '4242',
  expiryMonth: 8,
  expiryYear: 2029,
  statementDay: 12,
  dueDay: 2,
  status: 'Active',
  autoMonitor: false,
  monitoredConnectionIds: [],
  dailySpendingLimit: 0,
  createdAt: serverTimestamp(),
  lastUpdated: serverTimestamp(),
  lastUpdateSource: 'manual',
  ...o,
});
const seededCard = uid => ({ ...newCard(uid), createdAt: T('2026-01-01'), lastUpdated: T('2026-01-01') });

const newTxn = (uid, cardId, o = {}) => ({
  userId: uid, cardId, txnDate: T('2026-11-10'), amount: 499, direction: 'debit',
  description: 'SWIGGY', category: 'Food', source: 'manual', editedAfterReview: false,
  createdAt: serverTimestamp(), lastUpdated: serverTimestamp(), ...o,
});
const newStmt = (uid, cardId, o = {}) => ({
  userId: uid, cardId, statementDate: T('2026-11-12'), dueDate: T('2026-12-02'),
  totalDue: 18450, minDue: 920, paidAmount: 0, status: 'Unpaid', source: 'manual',
  createdAt: serverTimestamp(), lastUpdated: serverTimestamp(), ...o,
});
const seededReview = (uid, o = {}) => ({
  userId: uid, kind: 'transaction', origin: 'gmail', cardId: 'cardA',
  cardHint: { bankName: 'HDFC Bank', lastFourDigits: '4242' },
  extracted: { amount: 499 }, confidence: 0.9,
  email: { account: 'a@gmail.com', from: 'alerts@hdfcbank.net', subject: 's', messageId: 'm1', snippet: '' },
  status: 'pending', createdAt: T('2026-11-10'), ...o,
});
const approval = (cardId, targetId) => ({
  status: 'approved', cardId, targetId, edited: false, resolvedValues: {}, resolvedAt: serverTimestamp(),
});

describe('cards', () => {
  test('owner can create, update and delete a valid card', async () => {
    const db = as(ALICE);
    const ref = await assertSucceeds(addDoc(collection(db, 'cards'), newCard(ALICE)));
    await assertSucceeds(updateDoc(ref, { dueDay: 5, lastUpdated: serverTimestamp(), lastUpdateSource: 'manual' }));
    await assertSucceeds(deleteDoc(ref));
  });
  test('rejects full card numbers, CVV and out-of-range cycle values', async () => {
    const c = collection(as(ALICE), 'cards');
    await assertFails(addDoc(c, newCard(ALICE, { lastFourDigits: '4111111111114242' })));
    await assertFails(addDoc(c, newCard(ALICE, { cvv: '123' })));
    await assertFails(addDoc(c, newCard(ALICE, { expiryMonth: 13 })));
    await assertFails(addDoc(c, newCard(ALICE, { expiryYear: 2029.5 })));
    await assertFails(addDoc(c, newCard(ALICE, { statementDay: 0 })));
    await assertFails(addDoc(c, newCard(ALICE, { dueDay: 32 })));
    await assertFails(addDoc(c, newCard(ALICE, { annualFee: 500 })));
  });
  test('create must be manual, with server timestamps', async () => {
    const c = collection(as(ALICE), 'cards');
    await assertFails(addDoc(c, newCard(ALICE, { lastUpdateSource: 'review' })));
    await assertFails(addDoc(c, newCard(ALICE, { lastReviewId: 'x' })));
    await assertFails(addDoc(c, newCard(ALICE, { lastUpdated: T('2020-01-01') })));
  });
  test('cannot claim a review update without an approval in the same batch', async () => {
    await seed('cards/cardA', seededCard(ALICE));
    await seed('review_items/r1', seededReview(ALICE, { kind: 'card_update' }));
    await assertFails(updateDoc(doc(as(ALICE), 'cards/cardA'),
      { dueDay: 7, lastUpdated: serverTimestamp(), lastUpdateSource: 'review', lastReviewId: 'r1' }));
  });
  test('card_update approval batch succeeds', async () => {
    await seed('cards/cardA', seededCard(ALICE));
    await seed('review_items/r1', seededReview(ALICE, { kind: 'card_update', extracted: { dueDay: 7 } }));
    const db = as(ALICE);
    const b = writeBatch(db);
    b.update(doc(db, 'cards/cardA'), { dueDay: 7, lastUpdated: serverTimestamp(), lastUpdateSource: 'review', lastReviewId: 'r1' });
    b.update(doc(db, 'review_items/r1'), approval('cardA', 'cardA'));
    await assertSucceeds(b.commit());
  });
  test('other users are denied', async () => {
    await seed('cards/cardB', seededCard(BOB));
    const db = as(ALICE);
    await assertFails(getDoc(doc(db, 'cards/cardB')));
    await assertFails(updateDoc(doc(db, 'cards/cardB'), { status: 'Closed', lastUpdated: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'cards/cardB')));
    await assertFails(getDocs(collection(db, 'cards')));
  });
});

describe('card_transactions', () => {
  beforeEach(async () => {
    await seed('cards/cardA', seededCard(ALICE));
    await seed('cards/cardB', seededCard(BOB));
  });
  test('manual create on own card; list own; update; delete', async () => {
    const db = as(ALICE);
    const ref = await assertSucceeds(addDoc(collection(db, 'card_transactions'), newTxn(ALICE, 'cardA')));
    await assertSucceeds(getDocs(query(collection(db, 'card_transactions'), where('userId', '==', ALICE))));
    await assertSucceeds(updateDoc(ref, { amount: 550, lastUpdated: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });
  test('cannot attach to someone else\'s card or a missing card', async () => {
    const c = collection(as(ALICE), 'card_transactions');
    await assertFails(addDoc(c, newTxn(ALICE, 'cardB')));
    await assertFails(addDoc(c, newTxn(ALICE, 'nope')));
  });
  test('rejects zero amounts and unknown fields', async () => {
    const c = collection(as(ALICE), 'card_transactions');
    await assertFails(addDoc(c, newTxn(ALICE, 'cardA', { amount: 0 })));
    await assertFails(addDoc(c, newTxn(ALICE, 'cardA', { cardNumber: '4111111111111111' })));
  });
  test('cannot self-label a transaction as email/verified', async () => {
    await seed('review_items/r1', seededReview(ALICE));
    const c = collection(as(ALICE), 'card_transactions');
    await assertFails(addDoc(c, newTxn(ALICE, 'cardA', { source: 'email' })));
    await assertFails(addDoc(c, newTxn(ALICE, 'cardA', { source: 'email', reviewId: 'r1' }))); // review not approved in batch
  });
  test('approval batch: email transaction + review approval succeeds', async () => {
    await seed('review_items/r1', seededReview(ALICE));
    const db = as(ALICE);
    const txnRef = doc(collection(db, 'card_transactions'));
    const b = writeBatch(db);
    b.set(txnRef, newTxn(ALICE, 'cardA', { source: 'email', reviewId: 'r1' }));
    b.update(doc(db, 'review_items/r1'), approval('cardA', txnRef.id));
    await assertSucceeds(b.commit());
  });
  test('approval batch fails if source does not match the review origin', async () => {
    await seed('review_items/r1', seededReview(ALICE, { origin: 'demo' }));
    const db = as(ALICE);
    const txnRef = doc(collection(db, 'card_transactions'));
    const b = writeBatch(db);
    b.set(txnRef, newTxn(ALICE, 'cardA', { source: 'email', reviewId: 'r1' }));
    b.update(doc(db, 'review_items/r1'), approval('cardA', txnRef.id));
    await assertFails(b.commit());
  });
  test('an already-approved review cannot mint another transaction', async () => {
    await seed('review_items/r1', seededReview(ALICE, { status: 'approved', targetId: 'old' }));
    const db = as(ALICE);
    const txnRef = doc(collection(db, 'card_transactions'));
    const b = writeBatch(db);
    b.set(txnRef, newTxn(ALICE, 'cardA', { source: 'email', reviewId: 'r1' }));
    b.update(doc(db, 'review_items/r1'), { targetId: txnRef.id, resolvedAt: serverTimestamp() });
    await assertFails(b.commit());
  });
  test('update cannot change source or reviewId', async () => {
    await seed('card_transactions/t1', { ...newTxn(ALICE, 'cardA', { source: 'email', reviewId: 'r1' }), createdAt: T('2026-11-10'), lastUpdated: T('2026-11-10') });
    const ref = doc(as(ALICE), 'card_transactions/t1');
    await assertFails(updateDoc(ref, { source: 'manual', lastUpdated: serverTimestamp() }));
    await assertFails(updateDoc(ref, { reviewId: 'r2', lastUpdated: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { amount: 450, editedAfterReview: true, lastUpdated: serverTimestamp() }));
  });
});

describe('card_statements', () => {
  beforeEach(async () => seed('cards/cardA', seededCard(ALICE)));
  test('manual create and mark paid', async () => {
    const ref = await assertSucceeds(addDoc(collection(as(ALICE), 'card_statements'), newStmt(ALICE, 'cardA')));
    await assertSucceeds(updateDoc(ref, { paidAmount: 18450, status: 'Paid', lastUpdated: serverTimestamp() }));
  });
  test('rejects min > total and due before statement', async () => {
    const c = collection(as(ALICE), 'card_statements');
    await assertFails(addDoc(c, newStmt(ALICE, 'cardA', { minDue: 20000 })));
    await assertFails(addDoc(c, newStmt(ALICE, 'cardA', { dueDate: T('2026-11-01') })));
    await assertFails(addDoc(c, newStmt(ALICE, 'cardA', { status: 'Settled' })));
  });
  test('approval batch for a statement succeeds', async () => {
    await seed('review_items/r2', seededReview(ALICE, { kind: 'statement' }));
    const db = as(ALICE);
    const ref = doc(collection(db, 'card_statements'));
    const b = writeBatch(db);
    b.set(ref, newStmt(ALICE, 'cardA', { source: 'email', reviewId: 'r2' }));
    b.update(doc(db, 'review_items/r2'), approval('cardA', ref.id));
    await assertSucceeds(b.commit());
  });
  test('kind mismatch: a transaction review cannot approve a statement', async () => {
    await seed('review_items/r3', seededReview(ALICE, { kind: 'transaction' }));
    const db = as(ALICE);
    const ref = doc(collection(db, 'card_statements'));
    const b = writeBatch(db);
    b.set(ref, newStmt(ALICE, 'cardA', { source: 'email', reviewId: 'r3' }));
    b.update(doc(db, 'review_items/r3'), approval('cardA', ref.id));
    await assertFails(b.commit());
  });
});

describe('review_items', () => {
  beforeEach(async () => seed('cards/cardA', seededCard(ALICE)));
  const demo = (o = {}) => ({
    userId: ALICE, kind: 'transaction', origin: 'demo', cardId: 'cardA',
    cardHint: { bankName: 'HDFC Bank', lastFourDigits: '4242' }, extracted: { amount: 1 },
    confidence: 0.9, email: { subject: 's' }, status: 'pending', createdAt: serverTimestamp(), ...o,
  });
  test('client may create demo items only', async () => {
    const c = collection(as(ALICE), 'review_items');
    await assertSucceeds(addDoc(c, demo()));
    await assertFails(addDoc(c, demo({ origin: 'gmail' })));
    await assertFails(addDoc(c, demo({ status: 'approved' })));
    await assertFails(addDoc(c, demo({ userId: BOB })));
  });
  test('reject works; editing extracted data on the review does not', async () => {
    await seed('review_items/r1', seededReview(ALICE));
    const ref = doc(as(ALICE), 'review_items/r1');
    await assertFails(updateDoc(ref, { extracted: { amount: 1 }, status: 'rejected', resolvedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { status: 'rejected', resolvedAt: serverTimestamp() }));
  });
  test('approve without writing the target record fails', async () => {
    await seed('review_items/r1', seededReview(ALICE));
    await assertFails(updateDoc(doc(as(ALICE), 'review_items/r1'), approval('cardA', 'ghost')));
  });
  test('resolved items are final; pending items cannot be deleted', async () => {
    await seed('review_items/p', seededReview(ALICE));
    await seed('review_items/r', seededReview(ALICE, { status: 'rejected', resolvedAt: T('2026-11-10') }));
    const db = as(ALICE);
    await assertFails(updateDoc(doc(db, 'review_items/r'), { status: 'pending' }));
    await assertFails(deleteDoc(doc(db, 'review_items/p')));
    await assertSucceeds(deleteDoc(doc(db, 'review_items/r')));
  });
  test('other users cannot read or act on reviews', async () => {
    await seed('review_items/r1', seededReview(ALICE));
    const db = as(BOB);
    await assertFails(getDoc(doc(db, 'review_items/r1')));
    await assertFails(updateDoc(doc(db, 'review_items/r1'), { status: 'rejected', resolvedAt: serverTimestamp() }));
  });
});

describe('notifications', () => {
  const n = (o = {}) => ({
    userId: ALICE, type: 'new_transaction', title: 'New transaction', body: 'x', cardId: null,
    link: '/cards/review', read: false, origin: 'demo', createdAt: serverTimestamp(), ...o,
  });
  test('demo create; mark read; delete', async () => {
    const ref = await assertSucceeds(addDoc(collection(as(ALICE), 'notifications'), n()));
    await assertSucceeds(updateDoc(ref, { read: true, readAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });
  test('client cannot forge system notifications or edit content', async () => {
    const c = collection(as(ALICE), 'notifications');
    await assertFails(addDoc(c, n({ origin: 'system' })));
    await assertFails(addDoc(c, n({ read: true })));
    await seed('notifications/x', { ...n(), createdAt: T('2026-11-10') });
    await assertFails(updateDoc(doc(as(ALICE), 'notifications/x'), { title: 'changed' }));
  });
  test('other users cannot read', async () => {
    await seed('notifications/x', { ...n(), createdAt: T('2026-11-10') });
    await assertFails(getDoc(doc(as(BOB), 'notifications/x')));
  });
});

describe('server-only collections', () => {
  test('gmail_tokens is never readable by clients', async () => {
    await seed('gmail_tokens/t', { userId: ALICE, enc: 'x' });
    await assertFails(getDoc(doc(as(ALICE), 'gmail_tokens/t')));
  });
});

// ════════════════════════════════════════════════════════════════
// Phase B: Gmail-only verified identity, centralized review → income /
// expenses / bills, gmail_connections
// ════════════════════════════════════════════════════════════════
describe('identity gate (verified @gmail.com only)', () => {
  test('unverified Gmail password account cannot touch data', async () => {
    const db = as(ALICE, { email: 'alice@gmail.com', email_verified: false });
    await assertFails(addDoc(collection(db, 'expenses'), { userId: ALICE, amount: 1 }));
    await assertFails(getDoc(doc(db, `users/${ALICE}`)));
  });
  test('verified non-Gmail account cannot touch data', async () => {
    const db = as(ALICE, { email: 'alice@outlook.com', email_verified: true });
    await assertFails(addDoc(collection(db, 'expenses'), { userId: ALICE, amount: 1 }));
  });
  test('look-alike domains are rejected; case is ignored', async () => {
    await assertFails(addDoc(collection(as(ALICE, { email: 'a@gmail.com.evil.io', email_verified: true }), 'expenses'), { userId: ALICE }));
    await assertSucceeds(addDoc(collection(as(ALICE, { email: 'Alice@GMAIL.com', email_verified: true }), 'expenses'), { userId: ALICE }));
  });
});

describe('centralized review → income / expenses / bills', () => {
  beforeEach(async () => seed('cards/cardA', seededCard(ALICE)));
  const income = (o = {}) => ({ userId: ALICE, source: 'Salary', amount: 85000, date: T('2026-11-01'), month: '2026-11', ...o });

  test('manual income still works; imported fields cannot be self-applied', async () => {
    const c = collection(as(ALICE), 'income');
    await assertSucceeds(addDoc(c, income()));
    await assertFails(addDoc(c, income({ importedFrom: 'email' })));
    await seed('review_items/r1', seededReview(ALICE, { kind: 'income' }));
    await assertFails(addDoc(c, income({ importedFrom: 'email', reviewId: 'r1' })));
  });
  test('salary review approved into income in one batch', async () => {
    await seed('review_items/r1', seededReview(ALICE, { kind: 'income', cardId: null }));
    const db = as(ALICE);
    const ref = doc(collection(db, 'income'));
    const b = writeBatch(db);
    b.set(ref, income({ importedFrom: 'email', reviewId: 'r1' }));
    b.update(doc(db, 'review_items/r1'), { status: 'approved', cardId: null, targetId: ref.id, edited: false, resolvedValues: {}, resolvedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });
  test('reviewer can re-route a suggestion (transaction → expense)', async () => {
    await seed('review_items/r2', seededReview(ALICE, { kind: 'transaction' }));
    const db = as(ALICE);
    const ref = doc(collection(db, 'expenses'));
    const b = writeBatch(db);
    b.set(ref, { userId: ALICE, description: 'SWIGGY', amount: 350, category: 'Food', date: T('2026-11-07'), month: '2026-11', importedFrom: 'email', reviewId: 'r2' });
    b.update(doc(db, 'review_items/r2'), { status: 'approved', kind: 'expense', cardId: null, targetId: ref.id, edited: true, resolvedValues: {}, resolvedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });
  test('bill review approved into upcoming_payments', async () => {
    await seed('review_items/r3', seededReview(ALICE, { kind: 'bill', cardId: null }));
    const db = as(ALICE);
    const ref = doc(collection(db, 'upcoming_payments'));
    const b = writeBatch(db);
    b.set(ref, { userId: ALICE, description: 'Electricity bill', amount: 1845, category: 'Bills', dueDate: T('2026-11-25'), month: '2026-11', createdAt: T('2026-11-11'), importedFrom: 'email', reviewId: 'r3' });
    b.update(doc(db, 'review_items/r3'), { status: 'approved', cardId: null, targetId: ref.id, edited: false, resolvedValues: {}, resolvedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });
  test('cannot re-route into card_update, or approve a card kind without a card', async () => {
    await seed('review_items/r4', seededReview(ALICE, { kind: 'income' }));
    await assertFails(updateDoc(doc(as(ALICE), 'review_items/r4'), { status: 'approved', kind: 'card_update', cardId: 'cardA', targetId: 'cardA', edited: true, resolvedValues: {}, resolvedAt: serverTimestamp() }));
    await seed('review_items/r5', seededReview(ALICE, { kind: 'transaction', cardId: null }));
    const db = as(ALICE);
    const ref = doc(collection(db, 'card_transactions'));
    const b = writeBatch(db);
    b.set(ref, newTxn(ALICE, 'cardA', { source: 'email', reviewId: 'r5' }));
    b.update(doc(db, 'review_items/r5'), { status: 'approved', cardId: null, targetId: ref.id, edited: false, resolvedValues: {}, resolvedAt: serverTimestamp() });
    await assertFails(b.commit());
  });
  test('imported entries keep their provenance on edit', async () => {
    await seed('expenses/e1', { userId: ALICE, amount: 350, importedFrom: 'email', reviewId: 'r9' });
    const ref = doc(as(ALICE), 'expenses/e1');
    await assertSucceeds(updateDoc(ref, { amount: 360 }));
    await assertFails(updateDoc(ref, { importedFrom: 'demo' }));
    await seed('expenses/e2', { userId: ALICE, amount: 10 });
    await assertFails(updateDoc(doc(as(ALICE), 'expenses/e2'), { reviewId: 'r9' }));
  });
});

describe('gmail_connections', () => {
  const conn = (uid, o = {}) => ({ userId: uid, email: `${uid}@gmail.com`, status: 'active', paused: false, groups: ['salary', 'bank'], backfillDays: 30, ...o });
  test('owner can read, pause and choose categories', async () => {
    await seed('gmail_connections/c1', conn(ALICE));
    const ref = doc(as(ALICE), 'gmail_connections/c1');
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDocs(query(collection(as(ALICE), 'gmail_connections'), where('userId', '==', ALICE))));
    await assertSucceeds(updateDoc(ref, { paused: true }));
    await assertSucceeds(updateDoc(ref, { groups: ['cards', 'bills'] }));
  });
  test('owner cannot change status/email, add unknown groups, create or delete', async () => {
    await seed('gmail_connections/c1', conn(ALICE));
    const db = as(ALICE);
    const ref = doc(db, 'gmail_connections/c1');
    await assertFails(updateDoc(ref, { status: 'active', email: 'x@gmail.com' }));
    await assertFails(updateDoc(ref, { groups: ['everything'] }));
    await assertFails(setDoc(doc(db, 'gmail_connections/c2'), conn(ALICE)));
    await assertFails(deleteDoc(ref));
  });
  test('other users cannot see or change a connection', async () => {
    await seed('gmail_connections/c1', conn(ALICE));
    await assertFails(getDoc(doc(as(BOB), 'gmail_connections/c1')));
    await assertFails(updateDoc(doc(as(BOB), 'gmail_connections/c1'), { paused: true }));
  });
});

// ════════════════════════════════════════════════════════════════
// Phase 6: settings, push devices, client limit warnings
// ════════════════════════════════════════════════════════════════
describe('users/{uid}.settings', () => {
  const ok = { dailyLimit: 1500, reminderDays: 3, celebrate: true, push: { reviews: true, dues: false } };
  test('owner can save valid settings', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), `users/${ALICE}`), { uid: ALICE, settings: ok }, { merge: true }));
  });
  test('rejects invalid settings', async () => {
    const ref = doc(as(ALICE), `users/${ALICE}`);
    await assertFails(setDoc(ref, { uid: ALICE, settings: { ...ok, dailyLimit: -1 } }, { merge: true }));
    await assertFails(setDoc(ref, { uid: ALICE, settings: { ...ok, reminderDays: 30 } }, { merge: true }));
    await assertFails(setDoc(ref, { uid: ALICE, settings: { ...ok, isAdmin: true } }, { merge: true }));
    await assertFails(setDoc(ref, { uid: ALICE, settings: { ...ok, push: { reviews: true, marketing: true } } }, { merge: true }));
  });
});

describe('fcm_tokens', () => {
  const tok = (uid, o = {}) => ({ userId: uid, token: 'x'.repeat(152), appUrl: 'https://karthikkorrayi.github.io/smartshare-budget/', userAgent: 'Android Chrome', createdAt: serverTimestamp(), lastSeenAt: serverTimestamp(), ...o });
  test('device registers, refreshes and removes its own token', async () => {
    const ref = doc(as(ALICE), 'fcm_tokens/dev1');
    await assertSucceeds(setDoc(ref, tok(ALICE)));
    await assertSucceeds(setDoc(ref, { lastSeenAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(deleteDoc(ref));
  });
  test('cannot register for someone else, take over a token, or add fields', async () => {
    await assertFails(setDoc(doc(as(ALICE), 'fcm_tokens/dev2'), tok(BOB)));
    await seed('fcm_tokens/dev3', { ...tok(BOB), createdAt: T('2026-11-01'), lastSeenAt: T('2026-11-01') });
    await assertFails(setDoc(doc(as(ALICE), 'fcm_tokens/dev3'), tok(ALICE)));
    await assertFails(getDoc(doc(as(ALICE), 'fcm_tokens/dev3')));
    await assertFails(deleteDoc(doc(as(ALICE), 'fcm_tokens/dev3')));
    await assertFails(setDoc(doc(as(ALICE), 'fcm_tokens/dev4'), tok(ALICE, { admin: true })));
  });
});

describe('client limit warnings', () => {
  const warn = (o = {}) => ({ userId: ALICE, type: 'limit_exceeded', title: 'Daily limit crossed', body: 'x', cardId: null, link: '/', read: false, origin: 'client', createdAt: serverTimestamp(), ...o });
  test('client may record its own limit warning', async () => {
    await assertSucceeds(addDoc(collection(as(ALICE), 'notifications'), warn()));
  });
  test('client origin cannot be used for other notification types', async () => {
    await assertFails(addDoc(collection(as(ALICE), 'notifications'), warn({ type: 'review_pending' })));
    await assertFails(addDoc(collection(as(ALICE), 'notifications'), warn({ origin: 'system' })));
  });
});

describe('limit warnings and seen state (notification flow)', () => {
  const warn = { userId: ALICE, type: 'limit_exceeded', title: 'Daily limit crossed', body: 'x', cardId: null, link: '/', read: false, origin: 'client', createdAt: serverTimestamp() };
  test('one warning per limit per day: a fixed id can be created once, not overwritten', async () => {
    const ref = doc(as(ALICE), `notifications/limit-${ALICE}-20261113-all`);
    await assertSucceeds(setDoc(ref, warn));
    await assertFails(setDoc(ref, { ...warn, title: 'again' })); // an overwrite is an update → content can't change
    await assertSucceeds(updateDoc(ref, { read: true, readAt: serverTimestamp() }));
  });
  test('reading a missing warning id is refused (the app treats that as "not sent yet")', async () => {
    await assertFails(getDoc(doc(as(ALICE), `notifications/limit-${ALICE}-20261114-all`)));
  });
  test('seen reminders are stored on the own profile only', async () => {
    const seen = { uid: ALICE, notifSeen: { reminders: ['due-s1-overdue'], at: serverTimestamp() } };
    await assertSucceeds(setDoc(doc(as(ALICE), `users/${ALICE}`), seen, { merge: true }));
    await assertFails(setDoc(doc(as(BOB), `users/${ALICE}`), seen, { merge: true }));
  });
});

// ════════════════════════════════════════════════════════════════
// Wallets: cash, UPI wallets, prepaid cards
// ════════════════════════════════════════════════════════════════
function newWallet(uid, o = {}) {
  return { userId: uid, name: 'Paytm', kind: 'upi', provider: 'Paytm', openingBalance: 500, lowBalanceAlert: 100, status: 'Active',
    createdAt: serverTimestamp(), lastUpdated: serverTimestamp(), ...o };
}
function newWalletTxn(uid, walletId, o = {}) {
  return { userId: uid, walletId, type: 'spend', amount: 120, date: T('2026-11-12'), description: 'Tea', category: 'Food',
    createdAt: serverTimestamp(), lastUpdated: serverTimestamp(), ...o };
}

describe('wallets', () => {
  test('owner can create, update and delete a valid wallet', async () => {
    const db = as(ALICE);
    const ref = await assertSucceeds(addDoc(collection(db, 'wallets'), newWallet(ALICE)));
    await assertSucceeds(updateDoc(ref, { name: 'Paytm wallet', lastUpdated: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });
  test('invalid wallets are rejected', async () => {
    const c = collection(as(ALICE), 'wallets');
    await assertFails(addDoc(c, newWallet(ALICE, { kind: 'crypto' })));
    await assertFails(addDoc(c, newWallet(ALICE, { name: '' })));
    await assertFails(addDoc(c, newWallet(ALICE, { openingBalance: -1 })));
    await assertFails(addDoc(c, newWallet(ALICE, { balance: 999 }))); // balance is computed, never stored
    await assertFails(addDoc(c, newWallet(BOB)));
  });
  test('createdAt cannot be rewritten', async () => {
    await seed('wallets/w1', { ...newWallet(ALICE), createdAt: T('2026-11-01'), lastUpdated: T('2026-11-01') });
    await assertFails(updateDoc(doc(as(ALICE), 'wallets/w1'), { createdAt: T('2020-01-01'), lastUpdated: serverTimestamp() }));
  });
});

describe('wallet_transactions', () => {
  beforeEach(async () => {
    await seed('wallets/walletA', { ...newWallet(ALICE), createdAt: T('2026-11-01'), lastUpdated: T('2026-11-01') });
    await seed('wallets/walletB', { ...newWallet(BOB), createdAt: T('2026-11-01'), lastUpdated: T('2026-11-01') });
  });
  test('owner records every entry type against their own wallet', async () => {
    const c = collection(as(ALICE), 'wallet_transactions');
    for (const type of ['spend', 'topup', 'refund', 'cashback']) {
      await assertSucceeds(addDoc(c, newWalletTxn(ALICE, 'walletA', { type })));
    }
  });
  test("cannot write to someone else's wallet or with bad values", async () => {
    const c = collection(as(ALICE), 'wallet_transactions');
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletB')));
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'missing')));
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletA', { type: 'transfer' })));
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletA', { amount: 0 })));
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletA', { description: '' })));
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletA', { extra: true })));
  });
  test('edit and delete own entries', async () => {
    const ref = await assertSucceeds(addDoc(collection(as(ALICE), 'wallet_transactions'), newWalletTxn(ALICE, 'walletA')));
    await assertSucceeds(updateDoc(ref, { amount: 150, lastUpdated: serverTimestamp() }));
    await assertFails(updateDoc(ref, { walletId: 'walletB', lastUpdated: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });
});

describe('email → wallet (Review Center "Wallet" destination)', () => {
  const walletReview = (o = {}) => seededReview(ALICE, {
    kind: 'wallet', cardId: null, walletId: 'walletA', walletHint: { provider: 'Paytm' },
    extracted: { amount: 120, walletType: 'spend' }, ...o,
  });
  const walletApproval = (targetId, walletId = 'walletA') => ({
    status: 'approved', kind: 'wallet', cardId: null, walletId, targetId, edited: false, resolvedValues: {}, resolvedAt: serverTimestamp(),
  });
  beforeEach(async () => {
    await seed('cards/cardA', seededCard(ALICE));
    await seed('wallets/walletA', { ...newWallet(ALICE), createdAt: T('2026-11-01'), lastUpdated: T('2026-11-01') });
    await seed('wallets/walletB', { ...newWallet(BOB), createdAt: T('2026-11-01'), lastUpdated: T('2026-11-01') });
  });

  test('approval batch: email wallet entry + review approval succeeds', async () => {
    await seed('review_items/r1', walletReview());
    const db = as(ALICE);
    const ref = doc(collection(db, 'wallet_transactions'));
    const b = writeBatch(db);
    b.set(ref, newWalletTxn(ALICE, 'walletA', { source: 'email', reviewId: 'r1' }));
    b.update(doc(db, 'review_items/r1'), walletApproval(ref.id));
    await assertSucceeds(b.commit());
  });
  test('a card or bank review can be re-routed to a wallet', async () => {
    await seed('review_items/r2', seededReview(ALICE, { kind: 'expense', cardId: null }));
    const db = as(ALICE);
    const ref = doc(collection(db, 'wallet_transactions'));
    const b = writeBatch(db);
    b.set(ref, newWalletTxn(ALICE, 'walletA', { source: 'email', reviewId: 'r2' }));
    b.update(doc(db, 'review_items/r2'), walletApproval(ref.id));
    await assertSucceeds(b.commit());
  });
  test('an email wallet entry cannot be written without its approval', async () => {
    await seed('review_items/r1', walletReview());
    const c = collection(as(ALICE), 'wallet_transactions');
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletA', { source: 'email', reviewId: 'r1' })));
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletA', { source: 'email' })));
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletA', { reviewId: 'r1' }))); // no source, but a reviewId
    await assertFails(addDoc(c, newWalletTxn(ALICE, 'walletA', { source: 'manual', reviewId: 'r1' })));
  });
  test('manual entries still work, with or without source', async () => {
    const c = collection(as(ALICE), 'wallet_transactions');
    await assertSucceeds(addDoc(c, newWalletTxn(ALICE, 'walletA')));
    await assertSucceeds(addDoc(c, newWalletTxn(ALICE, 'walletA', { source: 'manual' })));
  });
  test("cannot approve into someone else's wallet", async () => {
    await seed('review_items/r1', walletReview());
    const db = as(ALICE);
    const ref = doc(collection(db, 'wallet_transactions'));
    const b = writeBatch(db);
    b.set(ref, newWalletTxn(ALICE, 'walletB', { source: 'email', reviewId: 'r1' }));
    b.update(doc(db, 'review_items/r1'), walletApproval(ref.id, 'walletB'));
    await assertFails(b.commit());
  });
  test('approved wallet entries keep their source and reviewId', async () => {
    await seed('wallet_transactions/t1', { ...newWalletTxn(ALICE, 'walletA', { source: 'email', reviewId: 'r1' }), createdAt: T('2026-11-10'), lastUpdated: T('2026-11-10') });
    const ref = doc(as(ALICE), 'wallet_transactions/t1');
    await assertSucceeds(updateDoc(ref, { amount: 130, lastUpdated: serverTimestamp() }));
    await assertFails(updateDoc(ref, { source: 'manual', lastUpdated: serverTimestamp() }));
    await assertFails(updateDoc(ref, { reviewId: 'r9', lastUpdated: serverTimestamp() }));
  });
  test('Gmail monitoring may include the wallets group', async () => {
    await seed('gmail_connections/c1', { userId: ALICE, email: 'alice@gmail.com', status: 'active', paused: false, groups: ['bank'] });
    const ref = doc(as(ALICE), 'gmail_connections/c1');
    await assertSucceeds(updateDoc(ref, { groups: ['bank', 'wallets'] }));
    await assertFails(updateDoc(ref, { groups: ['bank', 'crypto'] }));
  });
  test('demo wallet samples must point at the caller\'s own wallet', async () => {
    const c = collection(as(ALICE), 'review_items');
    const demo = o => ({ userId: ALICE, kind: 'wallet', origin: 'demo', cardId: null, walletId: 'walletA', walletHint: { provider: 'Paytm' },
      cardHint: { bankName: '', lastFourDigits: '' }, extracted: { amount: 1 }, confidence: 0.9, email: { subject: 's' },
      status: 'pending', createdAt: serverTimestamp(), ...o });
    await assertSucceeds(addDoc(c, demo()));
    await assertFails(addDoc(c, demo({ walletId: 'walletB' })));
  });
});

// ════════════════════════════════════════════════════════════════
// Phase 7.1: cross-user isolation matrix — every collection, every operation
// Alice owns one document in each collection; Bob (a valid, verified Gmail user)
// tries to read it directly, find it by query, change it, take it over and delete it.
// ════════════════════════════════════════════════════════════════
describe('isolation matrix (Bob vs Alice\'s data)', () => {
  const owned = {
    expenses: { userId: ALICE, amount: 100, description: 'x', date: T('2026-11-10'), month: '2026-11' },
    income: { userId: ALICE, amount: 100, source: 'x', date: T('2026-11-10'), month: '2026-11' },
    receivables: { userId: ALICE, amount: 100, month: '2026-11' },
    upcoming_payments: { userId: ALICE, amount: 100, month: '2026-11' },
    categories: { userId: ALICE, name: 'x' },
    cards: { ...seededCard(ALICE) },
    card_transactions: { ...newTxn(ALICE, 'cardA'), createdAt: T('2026-11-10'), lastUpdated: T('2026-11-10') },
    card_statements: { ...newStmt(ALICE, 'cardA'), createdAt: T('2026-11-10'), lastUpdated: T('2026-11-10') },
    review_items: seededReview(ALICE),
    notifications: { userId: ALICE, type: 'review_pending', title: 't', body: 'b', read: false, origin: 'system', createdAt: T('2026-11-10') },
    gmail_connections: { userId: ALICE, email: 'alice@gmail.com', status: 'active', paused: false, groups: ['bank'] },
    fcm_tokens: { userId: ALICE, token: 'x'.repeat(100), appUrl: 'https://a/', createdAt: T('2026-11-10'), lastSeenAt: T('2026-11-10') },
    wallets: { ...newWallet(ALICE), createdAt: T('2026-11-10'), lastUpdated: T('2026-11-10') },
    wallet_transactions: { ...newWalletTxn(ALICE, 'walletA'), createdAt: T('2026-11-10'), lastUpdated: T('2026-11-10') },
  };
  const serverOnly = ['gmail_tokens', 'email_sync_logs'];

  beforeEach(async () => {
    await seed('cards/cardA', seededCard(ALICE));
    await seed('wallets/walletA', { ...newWallet(ALICE), createdAt: T('2026-11-10'), lastUpdated: T('2026-11-10') });
    for (const [col, data] of Object.entries(owned)) await seed(`${col}/victim`, data);
    await seed(`users/${ALICE}`, { uid: ALICE, email: 'alice@gmail.com', settings: { dailyLimit: 1000 } });
    await seed(`metadata/${ALICE}`, { processedMonths: {} });
    for (const col of serverOnly) await seed(`${col}/victim`, { userId: ALICE, secret: 'x' });
  });

  for (const col of Object.keys(owned)) {
    test(`${col}: Bob cannot get, list, query-by-Alice, update, take over or delete`, async () => {
      const db = as(BOB);
      const ref = doc(db, `${col}/victim`);
      await assertFails(getDoc(ref));
      await assertFails(getDocs(collection(db, col)));
      await assertFails(getDocs(query(collection(db, col), where('userId', '==', ALICE))));
      await assertFails(updateDoc(ref, { read: true, paused: true, amount: 1 }));
      await assertFails(setDoc(ref, { ...owned[col], userId: BOB }));
      await assertFails(deleteDoc(ref));
      // Bob's own scoped query works and simply returns nothing of Alice's.
      const mine = await assertSucceeds(getDocs(query(collection(db, col), where('userId', '==', BOB))));
      if (mine.size !== 0) throw new Error(`${col}: Bob's query returned ${mine.size} docs`);
    });
  }

  test('users/{uid} and metadata/{uid}: Bob cannot read or overwrite Alice\'s', async () => {
    const db = as(BOB);
    await assertFails(getDoc(doc(db, `users/${ALICE}`)));
    await assertFails(setDoc(doc(db, `users/${ALICE}`), { uid: ALICE, settings: { dailyLimit: 0 } }, { merge: true }));
    await assertFails(getDoc(doc(db, `metadata/${ALICE}`)));
    await assertFails(setDoc(doc(db, `metadata/${ALICE}`), { processedMonths: {} }));
  });

  for (const col of serverOnly) {
    test(`${col}: no client access at all, not even for the owner`, async () => {
      await assertFails(getDoc(doc(as(ALICE), `${col}/victim`)));
      await assertFails(getDocs(query(collection(as(ALICE), col), where('userId', '==', ALICE))));
      await assertFails(setDoc(doc(as(ALICE), `${col}/mine`), { userId: ALICE }));
    });
  }

  test('a signed-out visitor gets nothing anywhere', async () => {
    const db = as(null);
    for (const col of [...Object.keys(owned), ...serverOnly]) {
      await assertFails(getDoc(doc(db, `${col}/victim`)));
    }
    await assertFails(getDoc(doc(db, `users/${ALICE}`)));
  });
});

// ── Redesign: bank accounts, transfers, account-linked entries ─────────────
const bank = (o = {}) => ({
  userId: ALICE, name: 'HDFC Savings', institution: 'HDFC Bank', kind: 'savings', lastFour: '4821',
  openingBalance: 25000, currency: 'INR', status: 'Active', createdAt: serverTimestamp(), lastUpdated: serverTimestamp(), ...o,
});

describe('bank_accounts', () => {
  test('owner can create, update and delete a valid account', async () => {
    const db = as(ALICE);
    const ref = await assertSucceeds(addDoc(collection(db, 'bank_accounts'), bank()));
    await assertSucceeds(updateDoc(ref, { name: 'Main', lastUpdated: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });

  test('negative opening balance (overdraft) is allowed; full account numbers and unknown fields are not', async () => {
    const db = as(ALICE);
    await assertSucceeds(addDoc(collection(db, 'bank_accounts'), bank({ openingBalance: -1200 })));
    await assertFails(addDoc(collection(db, 'bank_accounts'), bank({ lastFour: '123456789012' })));
    await assertFails(addDoc(collection(db, 'bank_accounts'), bank({ accountNumber: '50100123456789' })));
    await assertFails(addDoc(collection(db, 'bank_accounts'), bank({ kind: 'crypto' })));
  });

  test('other users are denied', async () => {
    await seed('bank_accounts/b1', { ...bank(), createdAt: Timestamp.now(), lastUpdated: Timestamp.now() });
    await assertFails(getDoc(doc(as(BOB), 'bank_accounts/b1')));
    await assertFails(deleteDoc(doc(as(BOB), 'bank_accounts/b1')));
    await assertFails(addDoc(collection(as(BOB), 'bank_accounts'), bank()));
  });
});

describe('account-linked expenses / income', () => {
  beforeEach(async () => {
    await seed('bank_accounts/a1', { ...bank(), createdAt: Timestamp.now(), lastUpdated: Timestamp.now() });
    await seed('bank_accounts/b1', { ...bank({ userId: BOB }), createdAt: Timestamp.now(), lastUpdated: Timestamp.now() });
  });

  test('can link to own account; cannot link to someone else\'s or a missing one', async () => {
    const db = as(ALICE);
    await assertSucceeds(addDoc(collection(db, 'expenses'), { userId: ALICE, amount: 10, accountType: 'bank', accountId: 'a1' }));
    await assertSucceeds(addDoc(collection(db, 'income'), { userId: ALICE, amount: 10, accountType: 'bank', accountId: 'a1' }));
    await assertFails(addDoc(collection(db, 'expenses'), { userId: ALICE, amount: 10, accountType: 'bank', accountId: 'b1' }));
    await assertFails(addDoc(collection(db, 'income'), { userId: ALICE, amount: 10, accountType: 'bank', accountId: 'nope' }));
  });

  test('unlinking (null) and unlinked legacy entries still work', async () => {
    const db = as(ALICE);
    const ref = await assertSucceeds(addDoc(collection(db, 'expenses'), { userId: ALICE, amount: 10, accountType: 'bank', accountId: 'a1' }));
    await assertSucceeds(updateDoc(ref, { accountType: null, accountId: null }));
    await assertSucceeds(addDoc(collection(db, 'expenses'), { userId: ALICE, amount: 3 }));
    await assertFails(updateDoc(ref, { accountType: 'bank', accountId: 'b1' }));
  });
});

describe('transfers', () => {
  beforeEach(async () => {
    await seed('bank_accounts/a1', { ...bank(), createdAt: Timestamp.now(), lastUpdated: Timestamp.now() });
    await seed('wallets/w1', { userId: ALICE, name: 'Paytm', kind: 'upi', openingBalance: 0, status: 'Active', createdAt: Timestamp.now(), lastUpdated: Timestamp.now() });
    await seed('wallets/wb', { userId: BOB, name: 'Bob cash', kind: 'cash', openingBalance: 0, status: 'Active', createdAt: Timestamp.now(), lastUpdated: Timestamp.now() });
  });
  const t = (o = {}) => ({ userId: ALICE, fromType: 'bank', fromId: 'a1', toType: 'wallet', toId: 'w1', amount: 500, date: Timestamp.now(), note: 'Top-up', createdAt: serverTimestamp(), ...o });

  test('bank → own wallet succeeds; delete succeeds', async () => {
    const ref = await assertSucceeds(addDoc(collection(as(ALICE), 'transfers'), t()));
    await assertSucceeds(deleteDoc(ref));
  });

  test('rejects someone else\'s account, same account both sides, zero amounts', async () => {
    const db = as(ALICE);
    await assertFails(addDoc(collection(db, 'transfers'), t({ toId: 'wb' })));
    await assertFails(addDoc(collection(db, 'transfers'), t({ toType: 'bank', toId: 'a1' })));
    await assertFails(addDoc(collection(db, 'transfers'), t({ amount: 0 })));
    await assertFails(addDoc(collection(db, 'transfers'), t({ fromType: 'card', fromId: 'c1' })));
  });
});
