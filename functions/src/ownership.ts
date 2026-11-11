import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Loads a Gmail connection only if it belongs to the caller. Another user's (or a made-up) id
 * gets the same 'not-found' answer, so ids can't be probed.
 */
export async function ownedConnection(uid: string, connectionId: unknown) {
  if (typeof connectionId !== 'string' || !/^[a-f0-9]{24}$/.test(connectionId)) {
    throw new HttpsError('invalid-argument', 'Unknown connection.');
  }
  const snap = await getFirestore().doc(`gmail_connections/${connectionId}`).get();
  if (!snap.exists || snap.get('userId') !== uid) throw new HttpsError('not-found', 'Connection not found.');
  return snap;
}
