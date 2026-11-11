/**
 * Rule-based classifier for Indian bank / card / bill emails.
 *
 * Pure functions only (no I/O) so they are unit-tested in src/test/classify.test.ts.
 * Output is a SUGGESTION: every result goes to the Review Center, where the user can
 * change the category, destination and every value before anything is saved.
 */

export const EMAIL_CATEGORIES = [
  'salary_credit',
  'bank_credit',
  'bank_debit',
  'card_transaction',
  'card_statement',
  'bill_generated',
  'payment_due',
  'payment_confirmation',
  'card_update',
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** Which app module an approved item goes to. */
export type Destination = 'income' | 'expense' | 'bill' | 'transaction' | 'statement' | 'card_update';

/** User-facing monitoring groups (toggled per Gmail connection). */
export const MONITOR_GROUPS = ['salary', 'bank', 'cards', 'bills', 'payments'] as const;
export type MonitorGroup = (typeof MONITOR_GROUPS)[number];

export const CATEGORY_GROUP: Record<EmailCategory, MonitorGroup> = {
  salary_credit: 'salary',
  bank_credit: 'bank',
  bank_debit: 'bank',
  card_transaction: 'cards',
  card_statement: 'cards',
  card_update: 'cards',
  bill_generated: 'bills',
  payment_due: 'bills',
  payment_confirmation: 'payments',
};

export interface Extracted {
  amount?: number;
  direction?: 'debit' | 'credit';
  txnDate?: Date;
  description?: string;
  category?: string; // suggested app category (Food, Salary, Bills…)
  statementDate?: Date;
  dueDate?: Date;
  totalDue?: number;
  minDue?: number;
  dueDay?: number;
}

export interface Classification {
  category: EmailCategory;
  destination: Destination;
  confidence: number; // 0–1
  extracted: Extracted;
  cardLast4: string | null;
  accountLast4: string | null;
  bankName: string | null;
}

export interface EmailInput {
  from: string;
  subject: string;
  body: string; // plain text (HTML already stripped)
  receivedAt: Date;
}

// ── Gmail search query: only financial-looking mail is ever fetched ───────────
// Keeps the read footprint small (data minimisation) and the sync fast.
export const GMAIL_KEYWORDS = [
  'credited', 'debited', 'spent', 'transaction', 'statement', 'salary',
  '"amount due"', '"due date"', '"payment received"', '"payment of"', 'bill',
  '"minimum due"', '"total due"', 'UPI', 'NEFT', 'IMPS', 'withdrawn', 'refund',
];
export function gmailQuery(afterEpochSeconds: number): string {
  return `after:${afterEpochSeconds} -in:chats -in:spam -in:trash {${GMAIL_KEYWORDS.join(' ')}}`;
}

// ── Small parsing helpers ─────────────────────────────────────────────────────

const AMOUNT = String.raw`(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

export function parseAmount(s: string): number | undefined {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

/** First currency amount in the text. */
export function firstAmount(text: string): number | undefined {
  const m = new RegExp(AMOUNT, 'i').exec(text);
  return m ? parseAmount(m[1]) : undefined;
}

/** Amount following a label, e.g. "Total Amount Due: Rs. 18,450.00". */
export function labelledAmount(text: string, label: RegExp): number | undefined {
  const re = new RegExp(label.source + String.raw`[^0-9₹]{0,25}(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`, 'i');
  const m = re.exec(text);
  return m ? parseAmount(m[1]) : undefined;
}

/**
 * Calendar date → Date at 12:00 IST (06:30 UTC), so the day is stable when shown in India.
 */
export function istNoon(y: number, monthIndex: number, d: number): Date | undefined {
  if (y < 100) y += 2000;
  if (monthIndex < 0 || monthIndex > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return undefined;
  const dt = new Date(Date.UTC(y, monthIndex, d, 6, 30));
  return dt.getUTCDate() === d ? dt : undefined; // rejects 31 Feb etc.
}

const DATE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => Date | undefined]> = [
  // 2026-11-10
  [/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/, m => istNoon(+m[1], +m[2] - 1, +m[3])],
  // 10-11-2026, 10/11/26, 10.11.2026  (Indian banks use DD-MM)
  [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/, m => istNoon(+m[3], +m[2] - 1, +m[1])],
  // 10-Nov-2026, 10 Nov 26, 10-NOV-26, 10th November 2026
  [/\b(\d{1,2})(?:st|nd|rd|th)?[-\s]([A-Za-z]{3,9})[-\s,]+(\d{2,4})\b/, m => {
    const mi = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mi === undefined ? undefined : istNoon(+m[3], mi, +m[1]);
  }],
  // Nov 10, 2026
  [/\b([A-Za-z]{3,9})\s(\d{1,2})(?:st|nd|rd|th)?,?\s(\d{4})\b/, m => {
    const mi = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mi === undefined ? undefined : istNoon(+m[3], mi, +m[2]);
  }],
];

export function firstDate(text: string): Date | undefined {
  let best: { index: number; date: Date } | undefined;
  for (const [re, fn] of DATE_PATTERNS) {
    const g = new RegExp(re.source, 'g' + (re.flags.includes('i') ? 'i' : ''));
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      const d = fn(m);
      if (d && (!best || m.index < best.index)) best = { index: m.index, date: d };
    }
  }
  return best?.date;
}

/** Date following a label, e.g. "Payment Due Date: 02-12-2026". */
export function labelledDate(text: string, label: RegExp): Date | undefined {
  const m = new RegExp(label.source + String.raw`[^0-9A-Za-z]{0,10}(.{0,30})`, 'i').exec(text);
  return m ? firstDate(m[1]) : undefined;
}

export function cardLast4(text: string): string | null {
  const m =
    /(?:credit\s*card|debit\s*card|\bcard\b)[^.\n]{0,40}?(?:ending(?:\s+(?:with|in))?|no\.?|number|xx+|x{2,}|\*{2,})[\sx*:#-]*(\d{4})\b/i.exec(text) ??
    /\b(?:xx|XX|\*\*)[x*X]*(\d{4})\b[^.\n]{0,25}\bcard\b/i.exec(text);
  return m ? m[1] : null;
}

export function accountLast4(text: string): string | null {
  const m = /(?:a\/c|acct|account)(?:\s*(?:no\.?|number))?[\s:.-]*[x*X]*\s*[x*X]*(\d{3,6})\b/i.exec(text);
  return m ? m[1].slice(-4) : null;
}

const BANKS: Array<[RegExp, string]> = [
  [/hdfc/i, 'HDFC Bank'], [/icici/i, 'ICICI Bank'], [/\bsbi\b|sbicard|state bank/i, 'SBI'],
  [/axis/i, 'Axis Bank'], [/kotak/i, 'Kotak Mahindra Bank'], [/yes\s?bank/i, 'Yes Bank'],
  [/idfc/i, 'IDFC FIRST Bank'], [/indusind/i, 'IndusInd Bank'], [/american express|amex/i, 'American Express'],
  [/\bau\s?(small finance|bank)/i, 'AU Small Finance Bank'], [/federal bank/i, 'Federal Bank'],
  [/canara/i, 'Canara Bank'], [/bank of baroda|\bbob\b/i, 'Bank of Baroda'], [/\bpnb\b|punjab national/i, 'Punjab National Bank'],
  [/union bank/i, 'Union Bank of India'], [/rbl/i, 'RBL Bank'], [/onecard/i, 'OneCard'],
];
export function detectBank(from: string, text: string): string | null {
  for (const [re, name] of BANKS) if (re.test(from)) return name;
  for (const [re, name] of BANKS) if (re.test(text)) return name;
  return null;
}

/** "at AMAZON PAY INDIA on …", "to SWIGGY via UPI", "Info: UPI/…/ZOMATO". */
export function merchant(text: string): string | undefined {
  const patterns = [
    /\bat\s+([A-Z0-9][A-Za-z0-9 &._'\/*-]{2,40}?)(?=\s+on\b|\s+dated\b|\.\s|,|\s+ref|\s+avl|\s+for\b|$)/,
    /\b(?:to|towards)\s+(?:VPA\s+)?([A-Za-z0-9][A-Za-z0-9 &._@'\/-]{2,40}?)(?=\s+on\b|\s+ref|\s+via\b|\.\s|,|\s+upi|$)/i,
    /\b(?:from|by)\s+([A-Z][A-Za-z0-9 &._'\/-]{2,40}?)(?=\s+on\b|\s+ref|\s+via\b|\.\s|,|$)/,
    /Info:\s*([A-Za-z0-9 &._\/-]{3,40})/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const v = m[1].trim().replace(/\s{2,}/g, ' ');
      if (!/^(your|the|a|an|card|account|a\/c)\b/i.test(v)) return v.slice(0, 60);
    }
  }
  return undefined;
}

export function suggestSpendCategory(desc: string): string {
  const d = desc.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/swiggy|zomato|restaurant|cafe|food|domino|pizza|kfc|mcdonald/, 'Food'],
    [/bigbasket|blinkit|zepto|grocer|dmart|supermarket|instamart/, 'Groceries'],
    [/amazon|flipkart|myntra|ajio|nykaa|meesho|shopping/, 'Shopping'],
    [/uber|ola|rapido|irctc|makemytrip|indigo|air india|redbus|goibibo|metro/, 'Travel'],
    [/petrol|fuel|hpcl|bpcl|indian oil|iocl|shell/, 'Fuel'],
    [/electric|bescom|tneb|tsspdcl|water|gas|broadband|airtel|jio|vodafone|\bvi\b|recharge|dth/, 'Bills'],
    [/netflix|prime video|hotstar|spotify|bookmyshow|pvr|inox/, 'Entertainment'],
    [/pharm|apollo|hospital|clinic|medplus|1mg|netmeds/, 'Health'],
    [/emi\b|loan/, 'EMI'],
  ];
  for (const [re, cat] of map) if (re.test(d)) return cat;
  return 'Others';
}

// ── Classification ────────────────────────────────────────────────────────────

const NOISE = /\b(otp|one[\s-]time password|verification code)\b|pre-?approved|offer valid|apply now|limited period offer|unsubscribe from (these|our) offers/i;
const PROMO_ONLY = /\b(offer|cashback offer|win|reward points? (are )?expiring|exclusive deal)\b/i;

export function classify(email: EmailInput): Classification | null {
  const subject = email.subject ?? '';
  const body = (email.body ?? '').replace(/\s+/g, ' ').slice(0, 6000);
  const text = `${subject}. ${body}`;
  const lower = text.toLowerCase();

  if (NOISE.test(text)) return null;

  const card = cardLast4(text);
  const account = accountLast4(text);
  const bank = detectBank(email.from ?? '', text);
  const amount = firstAmount(text);
  const date = firstDate(body) ?? firstDate(subject);
  const hasMoneyVerb = /\b(credited|debited|spent|paid|received|withdrawn|transferred|sent|purchase|charged|refund)/i.test(text);

  if (PROMO_ONLY.test(text) && !hasMoneyVerb && !/statement|due/i.test(text)) return null;

  const out = (
    category: EmailCategory,
    destination: Destination,
    extracted: Extracted,
    signals: number
  ): Classification => {
    let confidence = 0.35 + Math.min(signals, 4) * 0.12;
    if (extracted.amount ?? extracted.totalDue) confidence += 0.08;
    if (extracted.txnDate ?? extracted.dueDate ?? extracted.statementDate) confidence += 0.05;
    return {
      category,
      destination,
      confidence: Math.round(Math.min(confidence, 0.97) * 100) / 100,
      extracted,
      cardLast4: card,
      accountLast4: account,
      bankName: bank,
    };
  };

  // 1. Card due-date change ("your payment due date has been revised to the 5th")
  const dueChange = /(payment\s+)?due\s+date[^.]{0,60}?(?:changed|revised|updated|modified)[^.]{0,30}?(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text);
  if (dueChange && /card/i.test(text)) {
    const day = Number(dueChange[2]);
    if (day >= 1 && day <= 31) return out('card_update', 'card_update', { dueDay: day }, 3);
  }

  // 2. Card statement
  const totalDue = labelledAmount(text, /total\s+(?:amount\s+)?(?:due|outstanding)/);
  const minDue = labelledAmount(text, /min(?:imum)?\.?\s+(?:amount\s+)?due/);
  if (/statement/i.test(text) && (totalDue !== undefined || minDue !== undefined)) {
    const dueDate = labelledDate(text, /(?:payment\s+)?due\s+(?:date|by|on)/);
    const statementDate =
      labelledDate(text, /statement\s+(?:date|generated\s+on|dated)/) ?? labelledDate(text, /statement\s+for/) ?? date;
    return out(
      'card_statement',
      'statement',
      { totalDue: totalDue ?? 0, minDue: minDue ?? 0, dueDate, statementDate },
      2 + (card ? 1 : 0) + (dueDate ? 1 : 0)
    );
  }

  // 3. Payment confirmation ("payment of Rs 5,000 received towards your card")
  if (
    /(payment|amount)\s+(?:of\s+[^.]{0,30}?)?(?:has\s+been\s+)?(?:received|successful|credited\s+to\s+your\s+(?:credit\s+)?card|processed)|thank\s+you\s+for\s+(?:your|the)\s+payment|we\s+have\s+received\s+(?:your\s+)?payment/i.test(
      text
    )
  ) {
    const desc = card ? `${bank ?? 'Card'} bill payment` : merchant(text) ?? 'Bill payment';
    return out(
      'payment_confirmation',
      card ? 'transaction' : 'expense',
      { amount, direction: card ? 'credit' : 'debit', txnDate: date ?? email.receivedAt, description: desc, category: card ? 'Card Payment' : 'Bills' },
      2 + (card ? 1 : 0)
    );
  }

  // 4. Bill generated
  if (/\b(bill|invoice)\b[^.]{0,40}?\b(generated|is ready|has been generated|for the (?:month|period))|your\s+[a-z ]{0,25}\bbill\b[^.]{0,30}(?:amount|is|of)/i.test(text) && amount) {
    const dueDate = labelledDate(text, /due\s+(?:date|by|on)/);
    const what = /(electricity|water|gas|broadband|internet|mobile|postpaid|dth|insurance|rent)/i.exec(text)?.[1];
    return out(
      'bill_generated',
      'bill',
      { amount, dueDate, description: `${what ? what[0].toUpperCase() + what.slice(1).toLowerCase() + ' ' : ''}bill${bank ? ` · ${bank}` : ''}`.trim(), category: 'Bills' },
      2 + (dueDate ? 1 : 0)
    );
  }

  // 5. Payment due reminder
  if (/(payment|amount|bill)\s+(?:is\s+)?(?:due|overdue)|due\s+date\s+(?:is|on)|reminder[^.]{0,30}(?:payment|due)|pay\s+(?:by|before)/i.test(text) && (amount || totalDue)) {
    const dueDate = labelledDate(text, /(?:due\s+(?:date|by|on)|pay\s+(?:by|before))/) ?? date;
    return out(
      'payment_due',
      'bill',
      { amount: totalDue ?? amount, dueDate, description: card ? `${bank ?? 'Card'} ••${card} payment due` : 'Payment due', category: card ? 'Card Payment' : 'Bills' },
      2 + (dueDate ? 1 : 0)
    );
  }

  if (!amount) return null;

  // 6. Salary credit
  if (/\bsal(?:ary)?\b|payroll|\bSAL\s?CR\b|salary\s+credit/i.test(text) && /credit/i.test(lower)) {
    return out(
      'salary_credit',
      'income',
      { amount, direction: 'credit', txnDate: date ?? email.receivedAt, description: `Salary${bank ? ` · ${bank}` : ''}`, category: 'Salary' },
      3 + (account ? 1 : 0)
    );
  }

  // 7. Card transaction (spend or refund)
  if (card && /(spent|used|transaction|debited|purchase|charged|refund|reversal|credited)/i.test(text)) {
    const credit = /\b(refund|reversal|reversed|credited)\b/i.test(text) && !/\bdebited\b/i.test(text);
    const desc = merchant(text) ?? 'Card transaction';
    return out(
      'card_transaction',
      'transaction',
      { amount, direction: credit ? 'credit' : 'debit', txnDate: date ?? email.receivedAt, description: desc, category: credit ? 'Refund' : suggestSpendCategory(desc) },
      3
    );
  }

  // 8. Bank account credit / debit
  const acctLike = account || /\b(a\/c|account|upi|neft|imps|rtgs|vpa)\b/i.test(text);
  if (acctLike && /\b(credited|received|deposited)\b/i.test(text) && !/\bdebited\b/i.test(text)) {
    const desc = merchant(text) ?? 'Bank credit';
    return out('bank_credit', 'income', { amount, direction: 'credit', txnDate: date ?? email.receivedAt, description: desc, category: 'Other income' }, 2 + (account ? 1 : 0));
  }
  if (acctLike && /\b(debited|withdrawn|paid|sent|transferred)\b/i.test(text)) {
    const desc = merchant(text) ?? 'Bank debit';
    return out('bank_debit', 'expense', { amount, direction: 'debit', txnDate: date ?? email.receivedAt, description: desc, category: suggestSpendCategory(desc) }, 2 + (account ? 1 : 0));
  }

  return null;
}

// ── Body helpers ──────────────────────────────────────────────────────────────

/** Very small HTML → text converter (enough for bank alert templates). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

/** Short, single-line excerpt kept for the reviewer (never the full body). */
export function makeSnippet(text: string, max = 220): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}
