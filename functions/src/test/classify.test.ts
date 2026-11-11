import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, firstDate, gmailQuery, htmlToText, makeSnippet } from '../classify';

const at = new Date('2026-11-11T05:00:00Z');
const run = (from: string, subject: string, body: string) => classify({ from, subject, body, receivedAt: at });
const ymd = (d?: Date) => (d ? d.toISOString().slice(0, 10) : undefined);

test('HDFC credit card spend alert → card transaction', () => {
  const r = run(
    'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    'Alert : Update on your HDFC Bank Credit Card',
    'Dear Customer, Rs.1,249.50 was spent on your HDFC Bank Credit Card ending 4242 at AMAZON PAY INDIA on 10-11-2026 14:32:11. Not you? Call 18002586161'
  );
  assert.ok(r);
  assert.equal(r.category, 'card_transaction');
  assert.equal(r.destination, 'transaction');
  assert.equal(r.cardLast4, '4242');
  assert.equal(r.bankName, 'HDFC Bank');
  assert.equal(r.extracted.amount, 1249.5);
  assert.equal(r.extracted.direction, 'debit');
  assert.equal(r.extracted.description, 'AMAZON PAY INDIA');
  assert.equal(r.extracted.category, 'Shopping');
  assert.equal(ymd(r.extracted.txnDate), '2026-11-10');
});

test('ICICI card transaction with "XX" mask', () => {
  const r = run(
    'ICICI Bank <credit_cards@icicibank.com>',
    'Transaction alert for your ICICI Bank Credit Card',
    'Dear Customer, Your ICICI Bank Credit Card XX9876 has been used for a transaction of INR 499.00 on Nov 09, 2026 at 08:15:22. Info: SWIGGY.'
  );
  assert.ok(r);
  assert.equal(r.category, 'card_transaction');
  assert.equal(r.cardLast4, '9876');
  assert.equal(r.extracted.amount, 499);
  assert.equal(ymd(r.extracted.txnDate), '2026-11-09');
});

test('Card refund → credit', () => {
  const r = run(
    'alerts@axisbank.com',
    'Refund credited',
    'A refund of Rs 799.00 has been credited to your Axis Bank Credit Card no. XX1111 on 08-11-2026 from MYNTRA.'
  );
  assert.ok(r);
  assert.equal(r.category, 'card_transaction');
  assert.equal(r.extracted.direction, 'credit');
  assert.equal(r.extracted.category, 'Refund');
});

test('Salary credit via NEFT → income', () => {
  const r = run(
    'SBI <donotreply.sbiatm@alerts.sbi.co.in>',
    'Credit alert',
    'Dear Customer, your A/c XXXXX5678 is credited by Rs.85,000.00 on 01-11-2026 by NEFT-SALARY NOV ACME TECH PVT LTD. Avl Bal Rs 1,02,340.15'
  );
  assert.ok(r);
  assert.equal(r.category, 'salary_credit');
  assert.equal(r.destination, 'income');
  assert.equal(r.accountLast4, '5678');
  assert.equal(r.extracted.amount, 85000);
  assert.equal(ymd(r.extracted.txnDate), '2026-11-01');
});

test('UPI debit from bank account → expense', () => {
  const r = run(
    'Kotak Bank <bankalerts@kotak.com>',
    'Transaction Alert',
    'Sent Rs.350.00 from Kotak Bank AC X4321 to zomato@paytm on 07-11-26. UPI Ref 431234567890. Not you? Call 18602662666'
  );
  assert.ok(r);
  assert.equal(r.category, 'bank_debit');
  assert.equal(r.destination, 'expense');
  assert.equal(r.extracted.amount, 350);
  assert.equal(ymd(r.extracted.txnDate), '2026-11-07');
});

test('Other bank credit (not salary) → income', () => {
  const r = run(
    'alerts@hdfcbank.net',
    'You have received money',
    'Rs. 2,000.00 credited to your account XX7788 on 05-11-2026 from RAHUL SHARMA via IMPS. Ref no 6309.'
  );
  assert.ok(r);
  assert.equal(r.category, 'bank_credit');
  assert.equal(r.extracted.description, 'RAHUL SHARMA');
});

test('Credit card statement → statement with totals and dates', () => {
  const r = run(
    'HDFC Bank <emailstatements.cards@hdfcbank.net>',
    'Your HDFC Bank Credit Card Statement for Nov 2026',
    'Dear Cardmember, your statement for Credit Card ending 4242 is ready. Statement Date: 12-11-2026. Total Amount Due: Rs. 18,450.00 Minimum Amount Due: Rs. 920.00 Payment Due Date: 02-12-2026.'
  );
  assert.ok(r);
  assert.equal(r.category, 'card_statement');
  assert.equal(r.destination, 'statement');
  assert.equal(r.extracted.totalDue, 18450);
  assert.equal(r.extracted.minDue, 920);
  assert.equal(ymd(r.extracted.statementDate), '2026-11-12');
  assert.equal(ymd(r.extracted.dueDate), '2026-12-02');
  assert.equal(r.cardLast4, '4242');
});

test('Electricity bill generated → bill', () => {
  const r = run(
    'TSSPDCL <noreply@tssouthernpower.com>',
    'Your electricity bill is generated',
    'Your electricity bill for the month of Oct 2026 has been generated. Bill amount Rs. 1,845.00. Due date 25-11-2026.'
  );
  assert.ok(r);
  assert.equal(r.category, 'bill_generated');
  assert.equal(r.destination, 'bill');
  assert.equal(r.extracted.amount, 1845);
  assert.equal(ymd(r.extracted.dueDate), '2026-11-25');
});

test('Payment due reminder → bill', () => {
  const r = run(
    'sbicard <statements@sbicard.com>',
    'Payment reminder',
    'Reminder: payment of Rs. 6,200.00 on your SBI Card ending 1212 is due on 15 Nov 2026. Please pay by the due date to avoid late fees.'
  );
  assert.ok(r);
  assert.equal(r.category, 'payment_due');
  assert.equal(r.destination, 'bill');
  assert.equal(ymd(r.extracted.dueDate), '2026-11-15');
  assert.equal(r.extracted.amount, 6200);
});

test('Card payment received → transaction credit', () => {
  const r = run(
    'ICICI Bank <credit_cards@icicibank.com>',
    'Payment received',
    'Dear Customer, we have received payment of INR 18,450.00 towards your ICICI Bank Credit Card XX9876 on 01-12-2026. Thank you.'
  );
  assert.ok(r);
  assert.equal(r.category, 'payment_confirmation');
  assert.equal(r.destination, 'transaction');
  assert.equal(r.extracted.direction, 'credit');
  assert.equal(r.extracted.category, 'Card Payment');
});

test('Due date change → card update', () => {
  const r = run(
    'alerts@axisbank.com',
    'Change in payment due date',
    'Dear Customer, the payment due date for your Axis Bank Credit Card XX1111 has been revised to 5th of every month.'
  );
  assert.ok(r);
  assert.equal(r.category, 'card_update');
  assert.equal(r.extracted.dueDay, 5);
});

test('OTPs and offers are ignored', () => {
  assert.equal(run('alerts@hdfcbank.net', 'OTP for transaction', 'Your OTP for transaction of Rs 500 is 123456.'), null);
  assert.equal(run('offers@bank.com', 'Exclusive offer', 'Get a pre-approved personal loan of Rs 5,00,000. Apply now!'), null);
  assert.equal(run('friend@gmail.com', 'Lunch?', 'Shall we meet tomorrow?'), null);
});

test('date parsing formats', () => {
  assert.equal(ymd(firstDate('on 10-11-2026')), '2026-11-10');
  assert.equal(ymd(firstDate('on 10/11/26')), '2026-11-10');
  assert.equal(ymd(firstDate('on 2026-11-10')), '2026-11-10');
  assert.equal(ymd(firstDate('on 10-Nov-2026')), '2026-11-10');
  assert.equal(ymd(firstDate('on 10th November 2026')), '2026-11-10');
  assert.equal(ymd(firstDate('on Nov 10, 2026')), '2026-11-10');
  assert.equal(firstDate('on 31-02-2026'), undefined);
});

test('helpers', () => {
  assert.match(gmailQuery(1700000000), /^after:1700000000 /);
  assert.equal(htmlToText('<p>Rs&nbsp;100</p><br><b>&#8377;5</b>'), 'Rs 100\n₹5');
  assert.equal(makeSnippet('a'.repeat(300)).length, 220);
});
