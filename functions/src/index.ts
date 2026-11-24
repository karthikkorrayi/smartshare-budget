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
import { ownedConnection } from './ownership';
import { BillLite, CardLite, StatementLite, computeBillReminders, computeDueReminders, digest } from './reminders';
import { pushToUser } from './push';
import { RawEntry, buildDays, eveningCheckin, istClock, morningCelebration, weeklyRecap } from './discipline';
import { istDay } from './reminders';
import { getAuth } from 'firebase-admin/auth';

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
      walletsOffered: true, // groups chosen now already include the Wallets choice
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
 * Push scheduler — runs every hour (IST) and sends each user what they turned on, at the hours they
 * chose (users/{uid}.settings):
 *   morningHour (default 9):  card / bill due digest  +  streak milestone reached yesterday
 *   eveningHour (default 21): "nothing logged today" check-in  (Sundays: the weekly recap instead)
 * The name is kept from when it only sent the 09:00 digest, so deploying updates it in place.
 * Each kind is sent at most once per user per day (users/{uid}.pushLog), even if a run is retried.
 */
export const dailyDueDigest = onSchedule(
  { schedule: '0 * * * *', timeZone: 'Asia/Kolkata', region: REGION, timeoutSeconds: 540, memory: '256MiB', maxInstances: 1 },
  async () => {
    const now = new Date();
    const clock = istClock(now);
    const tokens = await db.collection('fcm_tokens').get();
    const users = [...new Set(tokens.docs.map(d => String(d.get('userId'))))];
    let sent = 0;
    for (const uid of users) {
      try {
        const userSnap = await db.doc(`users/${uid}`).get();
        const st = userSnap.get('settings') ?? {};
        const on = (k: string) => st?.push?.[k] !== false;
        const morning = clampHour(st.morningHour, 6, 11, 9);
        const evening = clampHour(st.eveningHour, 17, 23, 21);
        const log: Record<string, number> = userSnap.get('pushLog') ?? {};
        const fresh = (tag: string) => log[tag] !== clock.day;
        const jobs = {
          dues: on('dues') && clock.hour === morning && fresh('daily-due'),
          streak: on('streaks') && clock.hour === morning && fresh('streak'),
          weekly: on('weekly') && clock.hour === evening && clock.weekday === 0 && fresh('weekly'),
          checkin: on('checkin') && clock.hour === evening && fresh('checkin'),
        };
        if (!jobs.dues && !jobs.streak && !jobs.weekly && !jobs.checkin) continue;
        const done: Record<string, number> = {};

        if (jobs.dues) {
          const msg = await dueDigestFor(uid, Math.min(10, Math.max(1, Number(st.reminderDays) || 3)), now);
          if (msg) sent += await pushToUser(uid, { ...msg, route: '/notifications', tag: 'daily-due' }, 'dues', true);
          done['daily-due'] = clock.day;
        }
        if (jobs.streak || jobs.weekly || jobs.checkin) {
          const { days, since } = await disciplineDays(uid, userSnap, now);
          const limit = Math.max(0, Number(st.dailyLimit) || 0);
          const pushes: [string, ReturnType<typeof eveningCheckin>, 'streaks' | 'weekly' | 'checkin'][] = [];
          if (jobs.streak) pushes.push(['streak', morningCelebration(days, clock.day, since, limit), 'streaks']);
          const weekly = jobs.weekly ? weeklyRecap(days, clock.day, since, limit) : null;
          if (jobs.weekly) pushes.push(['weekly', weekly, 'weekly']);
          // Sunday's recap replaces the check-in, so it's one evening push.
          if (jobs.checkin && !weekly) pushes.push(['checkin', eveningCheckin(days, clock.day, since), 'checkin']);
          for (const [tag, msg, kind] of pushes) {
            if (msg) sent += await pushToUser(uid, msg, kind, true);
            done[tag] = clock.day;
          }
        }
        await userSnap.ref.set({ pushLog: done }, { merge: true });
      } catch (e) {
        logger.warn('push run failed', { uid, err: String(e) });
      }
    }
    logger.info('push run done', { hour: clock.hour, users: users.length, sent });
  }
);

function clampHour(v: unknown, min: number, max: number, def: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

/** Card payments due / overdue, statements tomorrow, and bills due — one digest. */
async function dueDigestFor(uid: string, lead: number, now: Date) {
  const [cardsSnap, stmtSnap, billSnap] = await Promise.all([
    db.collection('cards').where('userId', '==', uid).where('status', '==', 'Active').get(),
    db.collection('card_statements').where('userId', '==', uid).where('status', 'in', ['Unpaid', 'Partially Paid']).get(),
    db.collection('upcoming_payments').where('userId', '==', uid).get(),
  ]);
  const cards = cardsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as CardLite);
  const statements = stmtSnap.docs.map(d => {
    const x = d.data();
    return { id: d.id, ...x, statementDate: x.statementDate.toDate(), dueDate: x.dueDate.toDate() } as StatementLite;
  });
  const bills = billSnap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id,
      userId: uid,
      description: String(x.description ?? 'Payment'),
      amount: Number(x.amount) || 0,
      dueDate: typeof x.dueDate?.toDate === 'function' ? x.dueDate.toDate() : new Date(NaN),
      paused: !!x.paused,
      completed: !!x.completed,
      notify: x.notify !== false,
      reminderDays: x.reminderDays === undefined || x.reminderDays === null ? undefined : Number(x.reminderDays),
    } as BillLite;
  });
  return digest([...computeDueReminders(cards, statements, now, lead), ...computeBillReminders(bills, now, lead)]);
}

const DISCIPLINE_DAYS = 370;

/** A year of days (spending + whether anything was logged), same rules as the app. */
async function disciplineDays(uid: string, userSnap: FirebaseFirestore.DocumentSnapshot, now: Date) {
  const from = new Date(now.getTime() - DISCIPLINE_DAYS * 86_400_000);
  const months: string[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const [ex, cards, wallets, income, transfers, user] = await Promise.all([
    db.collection('expenses').where('userId', '==', uid).where('date', '>=', from).get(),
    db.collection('card_transactions').where('userId', '==', uid).where('txnDate', '>=', from).get(),
    db.collection('wallet_transactions').where('userId', '==', uid).get(),
    db.collection('income').where('userId', '==', uid).where('month', 'in', months).get(),
    db.collection('transfers').where('userId', '==', uid).get(),
    getAuth().getUser(uid).catch(() => null),
  ]);
  const ts = (v: any): Date | null => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null);
  const entries: RawEntry[] = [
    ...ex.docs.map(d => ({ kind: 'expense' as const, date: ts(d.get('date')), amount: Number(d.get('amount')) || 0, category: d.get('category'), status: d.get('status') })),
    ...cards.docs.map(d => ({ kind: 'card' as const, date: ts(d.get('txnDate')), amount: Number(d.get('amount')) || 0, category: d.get('category'), direction: d.get('direction') })),
    ...wallets.docs.map(d => ({ kind: 'wallet' as const, date: ts(d.get('date')), amount: Number(d.get('amount')) || 0, type: d.get('type') })),
    ...income.docs.map(d => ({ kind: 'income' as const, date: ts(d.get('date')), amount: Number(d.get('amount')) || 0, system: !!d.get('isSystemGenerated') })),
    ...transfers.docs.map(d => ({ kind: 'transfer' as const, date: ts(d.get('date')), amount: Number(d.get('amount')) || 0 })),
  ].filter(e => e.date && e.date >= from);
  const checkins = Object.keys(userSnap.get('checkins') ?? {});
  const created = user?.metadata.creationTime ? new Date(user.metadata.creationTime) : from;
  return { days: buildDays(entries, checkins), since: istDay(created) };
}

/** "Send a test notification" from the app: proves push works on the user's devices. */
export const sendTestPush = onCall({ region: REGION, timeoutSeconds: 30, memory: '256MiB', maxInstances: 5 }, async req => {
  const uid = requireUser(req);
  const sent = await pushToUser(uid, { title: 'Notifications are working ✅', body: 'This is how SmartShare reminders will look on this device.', route: '/streaks', tag: 'test' }, 'test');
  return { sent };
});
