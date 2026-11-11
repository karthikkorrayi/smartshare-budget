import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for Gmail refresh tokens.
 * The key lives only in Secret Manager; Firestore only ever holds ciphertext,
 * in a collection that security rules deny to every client.
 */
export interface Sealed {
  v: 1;
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
}

function key(b64: string): Buffer {
  const k = Buffer.from(b64.trim(), 'base64');
  if (k.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes (base64). Generate with: openssl rand -base64 32');
  return k;
}

export function seal(plain: string, keyB64: string, aad: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(keyB64), iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** `aad` binds the ciphertext to its connection: a token copied to another doc won't decrypt. */
export function open(s: Sealed, keyB64: string, aad: string): string {
  const d = createDecipheriv('aes-256-gcm', key(keyB64), Buffer.from(s.iv, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]).toString('utf8');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
