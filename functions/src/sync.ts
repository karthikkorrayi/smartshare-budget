import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { CATEGORY_GROUP, Classification, Extracted, MonitorGroup, classify, gmailQuery, makeSnippet } from './classify';
import { open, sha256, Sealed } from './crypto';
import { getMessage, listMessageIds } from './gmail';
import { OAuthError, accessToken } from './google';
import { MAX_MESSAGES_PER_RUN } from './config';
import { pushToUser } from './push';

const db = () => getFirestore();

export interface SyncStats {
  scanned: number;
  matched: number;
  created: number;
  duplicates: number;
  ignored: number;
  skipped: number;
  errors: number;
  complete: boolean;
}

interface Connection {
  userId: string;
  email: string;
  status: 'active' | 'reauth_required' | 'error';
  paused: boolean;
  groups: MonitorGroup[];
  backfillDays: number;
  lastSyncAt?: Timestamp;
  cursor?: { query: string; pageToken?: string; startedAt: Timestamp };
  syncLockUntil?: Timestamp;
}

interface Secrets {
  clientId: string;
  clientSecret: string;
  encKey: string;
}

const LOCK_MS = 6 * 60 * 1000;

/** Claims a short lease so the schedule and "Sync now" never process the same mailbox at once. */
async function acquireLock(connId: string): Promise<Connection | null> {
  const ref = db().doc(`gmail_connections/${connId}`);
  return db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const c = snap.data() as Connection;
    if (c.syncLockUntil && c.syncLockUntil.toMillis() > Date.now()) return null;
    tx.update(ref, { syncLockUntil: Timestamp.fromMillis(Date.now() + LOCK_MS) });
    return c;
  });
}

function toTs(d?: Date): Timestamp | undefined {
  return d ? Timestamp.fromDate(d) : undefined;
}

function extractedForFirestore(e: Extracted): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (v === undefined || v === null) continue;
    out[k] = v instanceof Date ? toTs(v) : v;
  }
  return out;
}

interface CardLite {
  id: string;
  bankName: string;
  lastFourDigits: string;
  status: string;
}

function matchCard(c: Classification, cards: CardLite[]): string | null {
  if (!c.cardLast4) return null;
  const hits = cards.filter(k => k.lastFourDigits === c.cardLast4);
  if (hits.length <= 1) return hits[0]?.id ?? null;
  const bank = (c.bankName ?? '').toLowerCase().split(' ')[0];
  const byBank = hits.filter(k => bank && k.bankName.toLowerCase().includes(bank));
  const active = (byBank.length ? byBank : hits).filter(k => k.status === 'Active');
  return (active[0] ?? byBank[0] ?? hits[0]).id;
}

/**
 * Scans one Gmail connection for new financial emails and files them as PENDING review items.
 * Never writes to income/expenses/cards directly — approval happens in the app.
 */
export async function syncConnection(connId: string, secrets: Secrets, budgetMs: number): Promise<SyncStats | 'busy' | 'missing'> {
  const started = Date.now();
  const conn = await acquireLock(connId);
  if (!conn) {
    const exists = (await db().doc(`gmail_connections/${connId}`).get()).exists;
    return exists ? 'busy' : 'missing';
  }
  const connRef = db().doc(`gmail_connections/${connId}`);
  const stats: SyncStats = { scanned: 0, matched: 0, created: 0, duplicates: 0, ignored: 0, skipped: 0, errors: 0, complete: false };

  try {
    // 1. Decrypt refresh token → access token.
    const tokenSnap = await db().doc(`gmail_tokens/${connId}`).get();
    if (!tokenSnap.exists) throw new OAuthError('invalid_grant', 'Stored Gmail access is missing. Reconnect this account.');
    const refresh = open(tokenSnap.get('sealed') as Sealed, secrets.encKey, connId);
    const token = await accessToken(secrets.clientId, secrets.clientSecret, refresh);

    // 2. Resume an unfinished scan, or start a new one from the last sync (10-min overlap; dedupe handles repeats).
    const now = Timestamp.now();
    let cursor = conn.cursor;
    if (!cursor) {
      const fromMs = conn.lastSyncAt
        ? conn.lastSyncAt.toMillis() - 10 * 60 * 1000
        : Date.now() - (conn.backfillDays || 30) * 86_400_000;
      cursor = { query: gmailQuery(Math.floor(fromMs / 1000)), startedAt: now };
    }

    const cardsSnap = await db().collection('cards').where('userId', '==', conn.userId).get();
    const cards: CardLite[] = cardsSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<CardLite, 'id'>) }));
    const groups = new Set<MonitorGroup>(conn.groups?.length ? conn.groups : ['salary', 'bank', 'cards', 'bills', 'payments']);

    // 3. Walk result pages until done, or until this run's message/time budget is spent.
    let pageToken = cursor.pageToken;
    let finished = false;
    outer: while (true) {
      const page = await listMessageIds(token, cursor.query, pageToken);
      for (const id of page.ids) {
        if (stats.scanned >= MAX_MESSAGES_PER_RUN || Date.now() - started > budgetMs) break outer;
        stats.scanned++;
        try {
          await processMessage(conn, connId, token, id, cards, groups, stats);
        } catch (e) {
          stats.errors++;
          logger.warn('message failed', { connId, id, err: String(e) });
        }
      }
      if (!page.next) {
        finished = true;
        break;
      }
      pageToken = page.next;
    }

    stats.complete = finished;
    await connRef.update({
      status: 'active',
      lastError: FieldValue.delete(),
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunStats: stats,
      ...(finished
        ? { lastSyncAt: cursor.startedAt, cursor: FieldValue.delete() }
        : { cursor: { query: cursor.query, startedAt: cursor.startedAt, ...(pageToken ? { pageToken } : {}) } }),
      syncLockUntil: FieldValue.delete(),
    });

    if (stats.created > 0) {
      await db().collection('notifications').add({
        userId: conn.userId,
        type: 'review_pending',
        title: `${stats.created} new item${stats.created === 1 ? '' : 's'} to review`,
        body: `Found in ${conn.email}. Approve, edit or reject them in the Review Center.`,
        cardId: null,
        link: '/review',
        read: false,
        origin: 'system',
        createdAt: FieldValue.serverTimestamp(),
      });
      await pushToUser(
        conn.userId,
        {
          title: `🔍 ${stats.created} new item${stats.created === 1 ? '' : 's'} to review`,
          body: `Found in ${conn.email}. Tap to approve, edit or reject.`,
          route: '/review',
          tag: 'review-pending',
        },
        'reviews'
      ).catch(e => logger.warn('review push failed', { err: String(e) }));
    }
    return stats;
  } catch (e: any) {
    const reauth = e instanceof OAuthError && e.code === 'invalid_grant';
    logger.error('sync failed', { connId, err: String(e?.message ?? e) });
    await connRef.update({
      status: reauth ? 'reauth_required' : 'error',
      lastError: String(e?.message ?? e).slice(0, 300),
      lastRunAt: FieldValue.serverTimestamp(),
      syncLockUntil: FieldValue.delete(),
    });
    if (reauth && conn.status !== 'reauth_required') {
      await db().collection('notifications').add({
        userId: conn.userId,
        type: 'review_pending',
        title: `Reconnect ${conn.email}`,
        body: 'Gmail access was revoked or expired, so monitoring is paused for this account.',
        cardId: null,
        link: '/gmail',
        read: false,
        origin: 'system',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    throw e;
  }
}

async function processMessage(
  conn: Connection,
  connId: string,
  token: string,
  gmailId: string,
  cards: CardLite[],
  groups: Set<MonitorGroup>,
  stats: SyncStats
): Promise<void> {
  // Cheap pre-check by Gmail id before downloading the message.
  const seenRef = db().doc(`email_sync_logs/${sha256(`${conn.userId}|gid|${connId}|${gmailId}`)}`);
  if ((await seenRef.get()).exists) {
    stats.duplicates++;
    return;
  }

  const msg = await getMessage(token, gmailId);
  // Same email delivered to two connected Gmail accounts shares the RFC 822 Message-ID → one review item.
  const dedupeKey = sha256(`${conn.userId}|mid|${msg.messageIdHeader || `${connId}:${gmailId}`}`);
  const logRef = db().doc(`email_sync_logs/${dedupeKey}`);

  const result = classify({ from: msg.from, subject: msg.subject, body: msg.body, receivedAt: new Date(msg.internalDate) });
  const receivedAt = Timestamp.fromMillis(msg.internalDate);
  const baseLog = { userId: conn.userId, connectionId: connId, gmailId, receivedAt, processedAt: FieldValue.serverTimestamp() };

  let outcome: string;
  const batch = db().batch();
  if (!result) {
    outcome = 'ignored';
    stats.ignored++;
  } else if (!groups.has(CATEGORY_GROUP[result.category])) {
    outcome = 'category_disabled';
    stats.skipped++;
  } else {
    outcome = 'review_created';
  }

  try {
    // Atomic claim: create() fails if this email was already processed (idempotent under retries/overlap).
    await logRef.create({
      ...baseLog,
      category: result?.category ?? null,
      result: outcome,
      ...(outcome === 'review_created' ? { sender: msg.from.slice(0, 200), subject: msg.subject.slice(0, 200), reviewId: dedupeKey } : {}),
    });
  } catch (e: any) {
    if (e?.code === 6 /* ALREADY_EXISTS */) {
      stats.duplicates++;
      await seenRef.set({ ...baseLog, result: 'duplicate', duplicateOf: dedupeKey });
      return;
    }
    throw e;
  }

  if (outcome === 'review_created' && result) {
    stats.matched++;
    const cardId = matchCard(result, cards);
    batch.create(db().doc(`review_items/${dedupeKey}`), {
      userId: conn.userId,
      connectionId: connId,
      origin: 'gmail',
      kind: result.destination,
      category: result.category,
      cardId,
      cardHint: { bankName: result.bankName ?? '', lastFourDigits: result.cardLast4 ?? '' },
      accountHint: result.accountLast4 ?? '',
      extracted: extractedForFirestore(result.extracted),
      confidence: cardId || !result.cardLast4 ? result.confidence : Math.max(0.3, result.confidence - 0.15),
      email: {
        account: conn.email,
        from: msg.from.slice(0, 200),
        subject: msg.subject.slice(0, 200),
        receivedAt,
        messageId: gmailId,
        snippet: makeSnippet(msg.body),
      },
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    stats.created++;
  }
  batch.set(seenRef, { ...baseLog, result: outcome, dedupeKey });
  await batch.commit();
}
