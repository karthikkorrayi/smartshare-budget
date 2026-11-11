/**
 * SmartShare Budget — Gmail integration (Cloud Functions v2, region asia-south1).
 *
 *   gmailConnect       callable   exchange OAuth code → encrypted refresh token, first scan
 *   gmailSyncNow       callable   scan one connection now
 *   gmailDisconnect    callable   revoke + delete stored access
 *   gmailScheduledSync schedule   every 30 min, all active connections
 *
 *   dailyDueDigest     schedule   09:00 IST, one push per user: overdue / due-soon payments, statement tomorrow
 *
 * Extracted data only ever becomes PENDING review_items. Nothing reaches the
 * financial collections until the user approves it in the app.
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ALLOWED_BACKFILL_DAYS, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, REGION, TOKEN_ENC_KEY, assertClientId } from './config';
import { MONITOR_GROUPS, MonitorGroup } from './classify';
import { open, seal, sha256, Sealed } from './crypto';
import { OAuthError, exchangeCode, revoke } from './google';
import { syncConnection } from './sync';
import { CardLite, StatementLite, computeDueReminders, digest } from './reminders';
import { pushToUser } from './push';

initializeApp();
const db = getFirestore();

const secrets = () => ({
  clientId: GMAIL_CLIENT_ID.value(),
  clientSecret: GMAIL_CLIENT_SECRET.value(),
  encKey: TOKEN_ENC_KEY.value(),
});

/** Signed in with a verified @gmail.com identity (same rule as Firestore). */
function requireUser(req: CallableRequest): string {
  const a = req.auth;
  if (!a) throw new HttpsError('unauthenticated', 'Sign in first.');
  const email = String(a.token.email ?? '').toLowerCase();
  if (!a.token.email_verified || !email.endsWith('@gmail.com')) {
    throw new HttpsError('permission-denied', 'A verified Gmail sign-in is required.');
  }
  return a.uid;
}

async function ownedConnection(uid: string, connectionId: unknown) {
  if (typeof connectionId !== 'string' || !/^[a-f0-9]{24}$/.test(connectionId)) {
    throw new HttpsError('invalid-argument', 'Unknown connection.');
  }
  const snap = await db.doc(`gmail_connections/${connectionId}`).get();
  if (!snap.exists || snap.get('userId') !== uid) throw new HttpsError('not-found', 'Connection not found.');
  return snap;
}

const callableOpts = {
  region: REGION,
  secrets: [GMAIL_CLIENT_SECRET, TOKEN_ENC_KEY],
  timeoutSeconds: 180,
  memory: '512MiB' as const,
  maxInstances: 5,
};

export const gmailConnect = onCall(callableOpts, async req => {
  const uid = requireUser(req);
  const { code, backfillDays, groups } = (req.data ?? {}) as { code?: string; backfillDays?: number; groups?: string[] };
  if (typeof code !== 'string' || code.length < 10 || code.length > 2048) throw new HttpsError('invalid-argument', 'Missing authorization code.');
  const days = ALLOWED_BACKFILL_DAYS.includes(Number(backfillDays)) ? Number(backfillDays) : 30;
  const chosen = (Array.isArray(groups) ? groups : []).filter((g): g is MonitorGroup => (MONITOR_GROUPS as readonly string[]).includes(g));

  try {
    assertClientId(GMAIL_CLIENT_ID.value());
  } catch (e: any) {
    logger.error('misconfigured GMAIL_CLIENT_ID', { err: e.message });
    throw new HttpsError('failed-precondition', 'Gmail integration is misconfigured on the server (GMAIL_CLIENT_ID). The app owner needs to fix it.');
  }

  let result;
  try {
    result = await exchangeCode(GMAIL_CLIENT_ID.value(), GMAIL_CLIENT_SECRET.value(), code);
  } catch (e) {
    if (e instanceof OAuthError) throw new HttpsError('failed-precondition', e.message, { reason: e.code });
    throw e;
  }

  const connId = sha256(`${uid}|${result.email}`).slice(0, 24);
  const connRef = db.doc(`gmail_connections/${connId}`);
  const existing = await connRef.get();

  await db.doc(`gmail_tokens/${connId}`).set({
    userId: uid,
    email: result.email,
    sealed: seal(result.refreshToken, TOKEN_ENC_KEY.value(), connId),
    scopes: result.scopes,
    googleSub: result.sub,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await connRef.set(
    {
      userId: uid,
      email: result.email,
      status: 'active',
      paused: existing.exists ? !!existing.get('paused') : false,
      groups: chosen.length ? chosen : existing.get('groups') ?? [...MONITOR_GROUPS],
      backfillDays: days,
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      reconnectedAt: FieldValue.serverTimestamp(),
      lastError: FieldValue.delete(),
      syncLockUntil: FieldValue.delete(),
    },
    { merge: true }
  );

  // First scan inline (bounded); anything left continues on the 30-minute schedule.
  let stats: unknown = null;
  try {
    stats = await syncConnection(connId, secrets(), 60_000);
  } catch (e) {
    logger.warn('initial sync failed', { connId, err: String(e) });
  }
  return { connectionId: connId, email: result.email, stats };
});

export const gmailSyncNow = onCall(callableOpts, async req => {
  const uid = requireUser(req);
  const snap = await ownedConnection(uid, req.data?.connectionId);
  if (snap.get('paused')) throw new HttpsError('failed-precondition', 'This connection is paused. Resume it first.');
  try {
    const stats = await syncConnection(snap.id, secrets(), 120_000);
    if (stats === 'busy') throw new HttpsError('aborted', 'A sync is already running for this account. Try again in a few minutes.');
    return { stats };
  } catch (e: any) {
    if (e instanceof HttpsError) throw e;
    if (e instanceof OAuthError) throw new HttpsError('failed-precondition', e.message, { reason: e.code });
    throw new HttpsError('internal', 'Sync failed. Check the connection status and try again.');
  }
});

export const gmailDisconnect = onCall({ ...callableOpts, timeoutSeconds: 60 }, async req => {
  const uid = requireUser(req);
  const snap = await ownedConnection(uid, req.data?.connectionId);
  const tokenRef = db.doc(`gmail_tokens/${snap.id}`);
  const token = await tokenRef.get();
  if (token.exists) {
    try {
      await revoke(open(token.get('sealed') as Sealed, TOKEN_ENC_KEY.value(), snap.id));
    } catch (e) {
      logger.warn('revoke failed (continuing)', { conn: snap.id, err: String(e) });
    }
  }
  const batch = db.batch();
  batch.delete(tokenRef);
  batch.delete(snap.ref);
  await batch.commit();
  // Pending review items already found stay in the Review Center until the user decides.
  return { ok: true };
});

export const gmailScheduledSync = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'Asia/Kolkata',
    region: REGION,
    secrets: [GMAIL_CLIENT_SECRET, TOKEN_ENC_KEY],
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 1,
  },
  async () => {
    const started = Date.now();
    const snap = await db.collection('gmail_connections').where('status', '==', 'active').where('paused', '==', false).get();
    let done = 0;
    for (const doc of snap.docs) {
      const left = 480_000 - (Date.now() - started);
      if (left < 30_000) break;
      try {
        await syncConnection(doc.id, secrets(), Math.min(left - 20_000, 240_000));
        done++;
      } catch (e) {
        logger.warn('scheduled sync failed', { conn: doc.id, err: String(e) });
      }
    }
    logger.info('scheduled sync finished', { connections: snap.size, done });
  }
);

/**
 * 09:00 IST daily: one push per user who enabled notifications, summarising card payments that are
 * overdue or due within their lead time, and statements generating tomorrow. (The in-app bell already
 * shows these live, so nothing is stored here — this only reaches users who are away from the app.)
 */
export const dailyDueDigest = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'Asia/Kolkata', region: REGION, timeoutSeconds: 300, memory: '256MiB', maxInstances: 1 },
  async () => {
    const tokens = await db.collection('fcm_tokens').get();
    const users = [...new Set(tokens.docs.map(d => String(d.get('userId'))))];
    const now = new Date();
    let sent = 0;
    for (const uid of users) {
      try {
        const [cardsSnap, stmtSnap, userSnap] = await Promise.all([
          db.collection('cards').where('userId', '==', uid).where('status', '==', 'Active').get(),
          db.collection('card_statements').where('userId', '==', uid).where('status', 'in', ['Unpaid', 'Partially Paid']).get(),
          db.doc(`users/${uid}`).get(),
        ]);
        if (cardsSnap.empty) continue;
        const lead = Math.min(10, Math.max(1, Number(userSnap.get('settings.reminderDays')) || 3));
        const cards = cardsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as CardLite);
        const statements = stmtSnap.docs.map(d => {
          const x = d.data();
          return { id: d.id, ...x, statementDate: x.statementDate.toDate(), dueDate: x.dueDate.toDate() } as StatementLite;
        });
        const msg = digest(computeDueReminders(cards, statements, now, lead));
        if (!msg) continue;
        sent += await pushToUser(uid, { ...msg, route: '/notifications', tag: 'daily-due' }, 'dues');
      } catch (e) {
        logger.warn('digest failed', { uid, err: String(e) });
      }
    }
    logger.info('daily digest done', { users: users.length, sent });
  }
);
