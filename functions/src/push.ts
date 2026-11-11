import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';

/** Which pushes a user wants (users/{uid}.settings.push). Missing = on. */
export type PushKind = 'reviews' | 'dues';

export interface PushMessage {
  title: string;
  body: string;
  /** In-app route, e.g. '/review'. */
  route: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag: string;
}

export async function wantsPush(uid: string, kind: PushKind): Promise<boolean> {
  const snap = await getFirestore().doc(`users/${uid}`).get();
  const v = snap.get(`settings.push.${kind}`);
  return v !== false;
}

/**
 * Sends a web push to every device the user enabled (fcm_tokens). Dead tokens are removed.
 * The click opens the app at `route` on the same site the device registered from.
 */
export async function pushToUser(uid: string, msg: PushMessage, kind: PushKind): Promise<number> {
  if (!(await wantsPush(uid, kind))) return 0;
  const db = getFirestore();
  const snap = await db.collection('fcm_tokens').where('userId', '==', uid).get();
  if (snap.empty) return 0;

  const docs = snap.docs;
  const messages = docs.map(d => {
    const appUrl = String(d.get('appUrl') ?? '');
    const link = appUrl.startsWith('https://') ? `${appUrl.replace(/#.*$/, '')}#${msg.route}` : undefined; // FCM requires https links
    return {
      token: String(d.get('token')),
      notification: { title: msg.title, body: msg.body },
      webpush: {
        notification: { tag: msg.tag, renotify: true, ...(link ? { icon: new URL('favicon.ico', appUrl).toString() } : {}) },
        ...(link ? { fcmOptions: { link } } : {}),
      },
      data: { route: msg.route, tag: msg.tag },
    };
  });

  const res = await getMessaging().sendEach(messages);
  const dead: Promise<unknown>[] = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code ?? '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument') {
      dead.push(docs[i].ref.delete());
    } else if (r.error) {
      logger.warn('push failed', { uid, code, msg: r.error.message });
    }
  });
  await Promise.all(dead);
  return res.successCount;
}
