/**
 * Integration tests for the Gmail sync engine against the Firestore EMULATOR, with a fake Gmail inbox.
 * Run:  npm run test:emulator      (from repo root: npm run test:functions:emulator)
 *
 * Covers Phase 7.2: malformed emails, duplicate delivery, concurrent syncs, revoked access,
 * unknown senders, resumable scans, card matching, and cross-user isolation.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { SyncDeps, syncConnection } from '../sync';
import { ownedConnection } from '../ownership';
import { seal } from '../crypto';
import { OAuthError } from '../google';
import { GmailMessage } from '../gmail';

const PROJECT = 'demo-smartshare-fn';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run via: npm run test:emulator');
}
initializeApp({ projectId: PROJECT });
const db = getFirestore();

const KEY = randomBytes(32).toString('base64');
const secrets = { clientId: '1-x.apps.googleusercontent.com', clientSecret: 's', encKey: KEY };
const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const CONN_A = 'a'.repeat(24);
const CONN_A2 = 'b'.repeat(24);
const CONN_B = 'c'.repeat(24);

async function clear(): Promise<void> {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedConnection(id: string, uid: string, email: string, o: Record<string, unknown> = {}): Promise<void> {
  await db.doc(`gmail_connections/${id}`).set({
    userId: uid, email, status: 'active', paused: false,
    groups: ['salary', 'bank', 'cards', 'bills', 'payments'], backfillDays: 30, ...o,
  });
  await db.doc(`gmail_tokens/${id}`).set({ userId: uid, email, sealed: seal('refresh-' + id, KEY, id) });
}

const msg = (id: string, subject: string, body: string, o: Partial<GmailMessage> = {}): GmailMessage => ({
  id, internalDate: Date.parse('2026-11-10T05:00:00Z'), from: 'alerts@hdfcbank.net', subject, messageIdHeader: `<${id}@mail>`, body, ...o,
});

const SALARY = msg('m-salary', 'Credit alert', 'Your A/c XX5678 is credited by Rs.85,000.00 on 01-11-2026 by NEFT-SALARY ACME TECH.');
const CARD = msg('m-card', 'Card alert', 'Rs.1,249.50 was spent on your HDFC Bank Credit Card ending 4242 at AMAZON PAY INDIA on 10-11-2026.');
const CARD_UNKNOWN = msg('m-card9', 'Card alert', 'Rs.300.00 was spent on your Credit Card ending 9999 at CAFE on 10-11-2026.');
const OTP = msg('m-otp', 'OTP', 'Your OTP for transaction of Rs 500 is 123456.');
const EMPTY = msg('m-empty', '', '', { from: '', messageIdHeader: '' });
const UNKNOWN_SENDER = msg('m-unk', 'Payment', 'Rs. 999 debited from your a/c XX1234 to SHOP via UPI on 10-11-2026.', { from: 'noreply@unknown.xyz' });

interface FakeOpts {
  pageSize?: number;
  broken?: string[];
  revoke?: boolean;
  /** Called once, when the sync downloads its first message (i.e. it already holds the lock). */
  onFirstFetch?: () => void;
  /** Every download waits for this — keeps a sync "in flight" for as long as the test needs. */
  hold?: Promise<void>;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

/** Fake Gmail: serves the given messages in pages of `pageSize`; ids listed in `broken` throw on fetch. */
function fakeGmail(messages: GmailMessage[], opts: FakeOpts = {}): SyncDeps & { fetched: string[] } {
  const pageSize = opts.pageSize ?? 50;
  const fetched: string[] = [];
  return {
    fetched,
    accessToken: async () => {
      if (opts.revoke) throw new OAuthError('invalid_grant', 'revoked');
      return 'token';
    },
    listMessageIds: async (_t, _q, pageToken) => {
      const start = pageToken ? Number(pageToken) : 0;
      const ids = messages.slice(start, start + pageSize).map(m => m.id);
      const next = start + pageSize < messages.length ? String(start + pageSize) : undefined;
      return { ids, next };
    },
    getMessage: async (_t, id) => {
      fetched.push(id);
      if (fetched.length === 1) opts.onFirstFetch?.();
      if (opts.hold) await opts.hold;
      if (opts.broken?.includes(id)) throw new Error('Gmail API 500: boom');
      const m = messages.find(x => x.id === id);
      if (!m) throw new Error('not found');
      return m;
    },
  };
}

const count = async (col: string, uid?: string) =>
  (uid ? await db.collection(col).where('userId', '==', uid).get() : await db.collection(col).get()).size;

before(clear);
after(clear);
beforeEach(async () => {
  await clear();
  await db.doc('cards/cardA').set({ userId: ALICE, bankName: 'HDFC Bank', lastFourDigits: '4242', status: 'Active' });
  await db.doc('cards/cardB').set({ userId: BOB, bankName: 'HDFC Bank', lastFourDigits: '4242', status: 'Active' });
  await seedConnection(CONN_A, ALICE, 'alice@gmail.com');
});

describe('sync engine (emulator)', () => {
  test('files PENDING review items only — never writes financial records', async () => {
    const stats = await syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY, CARD, OTP]));
    assert.ok(typeof stats === 'object');
    assert.equal(stats.created, 2);
    assert.equal(stats.ignored, 1);
    assert.equal(stats.complete, true);
    const items = await db.collection('review_items').where('userId', '==', ALICE).get();
    assert.equal(items.size, 2);
    for (const d of items.docs) {
      assert.equal(d.get('status'), 'pending');
      assert.equal(d.get('origin'), 'gmail');
      assert.ok((d.get('email.snippet') as string).length <= 220);
    }
    for (const col of ['income', 'expenses', 'upcoming_payments', 'card_transactions', 'card_statements']) {
      assert.equal(await count(col), 0, `${col} must stay empty until approval`);
    }
    const conn = await db.doc(`gmail_connections/${CONN_A}`).get();
    assert.ok(conn.get('lastSyncAt'));
    assert.equal(conn.get('syncLockUntil'), undefined);
    const notes = await db.collection('notifications').where('userId', '==', ALICE).get();
    assert.equal(notes.size, 1);
    assert.equal(notes.docs[0].get('type'), 'review_pending');
  });

  test('re-running is idempotent (no duplicate review items)', async () => {
    const gmail = fakeGmail([SALARY, CARD]);
    await syncConnection(CONN_A, secrets, 60_000, gmail);
    await db.doc(`gmail_connections/${CONN_A}`).update({ lastSyncAt: null }); // force a full rescan
    const again = await syncConnection(CONN_A, secrets, 60_000, gmail);
    assert.ok(typeof again === 'object');
    assert.equal(again.created, 0);
    assert.equal(again.duplicates, 2);
    assert.equal(await count('review_items', ALICE), 2);
  });

  test('the same email delivered to two connected Gmail accounts creates ONE item', async () => {
    await seedConnection(CONN_A2, ALICE, 'alice.work@gmail.com');
    await syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY]));
    const other = await syncConnection(CONN_A2, secrets, 60_000, fakeGmail([{ ...SALARY, id: 'different-gmail-id' }]));
    assert.ok(typeof other === 'object');
    assert.equal(other.created, 0);
    assert.equal(other.duplicates, 1);
    assert.equal(await count('review_items', ALICE), 1);
  });

  test('a sync that starts while another holds the lock is refused ("busy")', async () => {
    const started = deferred();
    const release = deferred();
    // Sync 1 takes the lock, downloads its first email, then pauses mid-scan.
    const first = syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY, CARD], { onFirstFetch: started.resolve, hold: release.promise }));
    await started.promise;

    const second = await syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY, CARD]));
    assert.equal(second, 'busy');

    release.resolve();
    const r = await first;
    assert.ok(typeof r === 'object');
    assert.equal(r.created, 2);
    assert.equal(await count('review_items', ALICE), 2);
    assert.equal((await db.doc(`gmail_connections/${CONN_A}`).get()).get('syncLockUntil'), undefined); // lock released
  });

  test('two syncs racing from the same instant never create duplicates', async () => {
    // Depending on timing the second one is refused, or runs after the first finished.
    // Either way: exactly 2 items in total, each email filed once.
    const results = await Promise.all([
      syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY, CARD])),
      syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY, CARD])),
    ]);
    const ran = results.filter((x): x is Exclude<typeof x, 'busy' | 'missing'> => typeof x === 'object');
    assert.ok(ran.length >= 1);
    assert.equal(ran.reduce((n, x) => n + x.created, 0), 2);
    assert.equal(await count('review_items', ALICE), 2);
  });

  test('a failing or malformed message does not stop the rest', async () => {
    const stats = await syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY, EMPTY, CARD], { broken: ['m-card'] }));
    assert.ok(typeof stats === 'object');
    assert.equal(stats.errors, 1);
    assert.equal(stats.ignored, 1); // empty email
    assert.equal(stats.created, 1); // salary
  });

  test('unknown sender domain is still filed for review (the user decides)', async () => {
    const stats = await syncConnection(CONN_A, secrets, 60_000, fakeGmail([UNKNOWN_SENDER]));
    assert.ok(typeof stats === 'object');
    assert.equal(stats.created, 1);
    const item = (await db.collection('review_items').get()).docs[0];
    assert.equal(item.get('category'), 'bank_debit');
    assert.equal(item.get('email.from'), 'noreply@unknown.xyz');
  });

  test('disabled categories are skipped', async () => {
    await db.doc(`gmail_connections/${CONN_A}`).update({ groups: ['cards'] });
    const stats = await syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY, CARD]));
    assert.ok(typeof stats === 'object');
    assert.equal(stats.skipped, 1);
    assert.equal(stats.created, 1);
    assert.equal((await db.collection('review_items').get()).docs[0].get('category'), 'card_transaction');
  });

  test('card matching uses the OWNER\'s cards; unknown last-4 stays unmatched with lower confidence', async () => {
    await syncConnection(CONN_A, secrets, 60_000, fakeGmail([CARD, CARD_UNKNOWN]));
    const items = (await db.collection('review_items').get()).docs;
    const matched = items.find(d => d.get('cardHint.lastFourDigits') === '4242')!;
    const unmatched = items.find(d => d.get('cardHint.lastFourDigits') === '9999')!;
    assert.equal(matched.get('cardId'), 'cardA'); // never Bob's cardB with the same last-4
    assert.equal(unmatched.get('cardId'), null);
    assert.ok(unmatched.get('confidence') < matched.get('confidence'));
  });

  test('revoked access → reconnect required + notification, and the error surfaces', async () => {
    await assert.rejects(syncConnection(CONN_A, secrets, 60_000, fakeGmail([SALARY], { revoke: true })));
    const conn = await db.doc(`gmail_connections/${CONN_A}`).get();
    assert.equal(conn.get('status'), 'reauth_required');
    assert.equal(conn.get('syncLockUntil'), undefined);
    const notes = await db.collection('notifications').where('userId', '==', ALICE).get();
    assert.equal(notes.docs[0].get('link'), '/gmail');
  });

  test('a scan cut short by its time budget resumes where it stopped', async () => {
    const inbox = [SALARY, CARD, UNKNOWN_SENDER];
    const first = await syncConnection(CONN_A, secrets, -1, fakeGmail(inbox, { pageSize: 2 }));
    assert.ok(typeof first === 'object');
    assert.equal(first.complete, false);
    assert.ok((await db.doc(`gmail_connections/${CONN_A}`).get()).get('cursor'));
    const second = await syncConnection(CONN_A, secrets, 60_000, fakeGmail(inbox, { pageSize: 2 }));
    assert.ok(typeof second === 'object');
    assert.equal(second.complete, true);
    const conn = await db.doc(`gmail_connections/${CONN_A}`).get();
    assert.equal(conn.get('cursor'), undefined);
    assert.equal(await count('review_items', ALICE), 3);
  });

  test('a tampered token (copied to another connection) cannot be decrypted', async () => {
    await seedConnection(CONN_B, BOB, 'bob@gmail.com');
    const aliceToken = await db.doc(`gmail_tokens/${CONN_A}`).get();
    await db.doc(`gmail_tokens/${CONN_B}`).update({ sealed: aliceToken.get('sealed') });
    await assert.rejects(syncConnection(CONN_B, secrets, 60_000, fakeGmail([SALARY])));
    assert.equal(await count('review_items', BOB), 0);
  });
});

describe('ownership checks for callables', () => {
  test('owner can load their connection', async () => {
    const snap = await ownedConnection(ALICE, CONN_A);
    assert.equal(snap.get('email'), 'alice@gmail.com');
  });
  test("another user's connection id is 'not-found'", async () => {
    await assert.rejects(ownedConnection(BOB, CONN_A), (e: unknown) => e instanceof HttpsError && e.code === 'not-found');
  });
  test('malformed ids are rejected before any read', async () => {
    for (const bad of [undefined, 42, '', '../gmail_tokens/x', 'A'.repeat(24)]) {
      await assert.rejects(ownedConnection(ALICE, bad), (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument');
    }
  });
});

// keep Timestamp import used for type parity with production code paths
void Timestamp;