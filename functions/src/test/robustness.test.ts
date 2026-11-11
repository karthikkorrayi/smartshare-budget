import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, htmlToText, makeSnippet } from '../classify';

const at = new Date('2026-11-11T05:00:00Z');
const run = (from: string, subject: string, body: string) => classify({ from, subject, body, receivedAt: at });

// ── Malformed / hostile input must never throw ─────────────────────
test('empty, missing and garbage fields do not throw', () => {
  assert.equal(run('', '', ''), null);
  assert.equal(classify({ from: undefined as any, subject: undefined as any, body: undefined as any, receivedAt: at }), null);
  assert.doesNotThrow(() => run('x', '\u0000\u0001￿', '\uD800 broken surrogate ₹ Rs. ,,, ..'));
  assert.doesNotThrow(() => run('a@b', 'Rs.', 'Rs. INR ₹ credited debited statement due'));
});

test('absurd amounts and dates are not accepted as values', () => {
  const r = run('alerts@hdfcbank.net', 'Alert', 'Rs.0.00 spent on Credit Card ending 4242 at X on 99-99-9999');
  assert.equal(r, null); // zero amount → nothing to review
  const r2 = run('alerts@hdfcbank.net', 'Alert', 'Rs.500 spent on Credit Card ending 4242 at SHOP on 31-02-2026');
  assert.ok(r2);
  assert.equal(r2.extracted.txnDate?.toISOString(), at.toISOString()); // invalid date → falls back to received time
});

test('unknown sender domain is still classified by content (and flagged by bank = null)', () => {
  const r = run('noreply@totally-unknown-sender.xyz', 'Payment', 'Rs. 999 debited from your a/c XX1234 to SHOP via UPI on 10-11-2026.');
  assert.ok(r);
  assert.equal(r.category, 'bank_debit');
  assert.equal(r.bankName, null);
});

test('phishing-style mail with link but no transaction facts is ignored', () => {
  assert.equal(run('security@hdfc-bank-verify.xyz', 'Account blocked', 'Your account is blocked. Click here to verify your KYC immediately.'), null);
});

// ── Performance: no catastrophic regex backtracking ────────────────
test('adversarial long inputs classify quickly (< 150 ms each)', () => {
  const inputs = [
    'card '.repeat(5000),
    'Rs.' + '9,'.repeat(4000),
    'due date '.repeat(3000),
    'at A'.repeat(4000) + ' on',
    ('statement total amount due minimum due ').repeat(800),
    'a/c '.repeat(4000) + 'X'.repeat(5000),
    'x'.repeat(200_000),
    '<td>'.repeat(20_000) + 'Rs 10' + '</td>'.repeat(20_000),
  ];
  for (const s of inputs) {
    const t = performance.now();
    run('a@b.c', s.slice(0, 200), s);
    htmlToText(s);
    const ms = performance.now() - t;
    assert.ok(ms < 150, `took ${ms.toFixed(0)} ms on input starting "${s.slice(0, 20)}"`);
  }
});

test('random fuzz: 2000 mixed inputs never throw', () => {
  const words = ['Rs.', 'INR', '₹', '1,234.50', 'credited', 'debited', 'card', 'ending', '4242', 'XX9999', 'a/c', 'statement',
    'total amount due', 'minimum due', 'due date', '10-11-2026', 'Nov 10, 2026', 'salary', 'refund', 'at', 'SHOP', 'to', 'UPI', 'OTP', 'bill', 'generated', '\n', '.', ','];
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 2000; i++) {
    const n = 5 + Math.floor(rnd() * 60);
    const body = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(' ');
    assert.doesNotThrow(() => {
      const r = run('alerts@bank.com', body.slice(0, 40), body);
      if (r) {
        assert.ok(r.confidence > 0 && r.confidence <= 0.97);
        if (r.extracted.amount !== undefined) assert.ok(r.extracted.amount > 0);
      }
    });
  }
});

test('snippet is bounded and single-line', () => {
  const s = makeSnippet('line1\n\nline2\t\t' + 'z'.repeat(1000));
  assert.ok(s.length <= 220);
  assert.ok(!/\n/.test(s));
});
