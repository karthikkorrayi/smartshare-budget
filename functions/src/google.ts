import { OAuth2Client } from 'google-auth-library';
import { GMAIL_SCOPE } from './config';

/** Popup-mode Google Identity Services code client → server exchange uses 'postmessage'. */
const REDIRECT = 'postmessage';

export interface ExchangeResult {
  email: string;
  sub: string;
  refreshToken: string;
  scopes: string[];
}

export class OAuthError extends Error {
  constructor(public readonly code: 'invalid_grant' | 'missing_scope' | 'no_refresh_token' | 'not_gmail' | 'unverified' | 'other', message: string) {
    super(message);
  }
}

export function client(clientId: string, clientSecret: string): OAuth2Client {
  return new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT });
}

/** Exchanges the one-time code and proves which Gmail account granted it. */
export async function exchangeCode(clientId: string, clientSecret: string, code: string): Promise<ExchangeResult> {
  const c = client(clientId, clientSecret);
  let tokens;
  try {
    ({ tokens } = await c.getToken(code));
  } catch (e: any) {
    throw new OAuthError(e?.response?.data?.error === 'invalid_grant' ? 'invalid_grant' : 'other', 'Google rejected the authorization code. Try connecting again.');
  }
  const scopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(GMAIL_SCOPE)) {
    throw new OAuthError('missing_scope', 'Gmail read access was not granted. Tick "View your email messages and settings" on the consent screen.');
  }
  if (!tokens.refresh_token) throw new OAuthError('no_refresh_token', 'Google did not return offline access. Remove the app at myaccount.google.com/permissions and connect again.');
  if (!tokens.id_token) throw new OAuthError('other', 'Google did not return an identity token (openid email scope missing).');

  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
  const p = ticket.getPayload();
  const email = (p?.email ?? '').toLowerCase();
  if (!p?.email_verified) throw new OAuthError('unverified', 'This Google account email is not verified.');
  if (!email.endsWith('@gmail.com')) throw new OAuthError('not_gmail', 'Only @gmail.com accounts can be connected.');

  return { email, sub: p.sub, refreshToken: tokens.refresh_token, scopes };
}

/** Short-lived access token from the stored refresh token. */
export async function accessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const c = client(clientId, clientSecret);
  c.setCredentials({ refresh_token: refreshToken });
  try {
    const { token } = await c.getAccessToken();
    if (!token) throw new Error('empty token');
    return token;
  } catch (e: any) {
    const err = e?.response?.data?.error ?? e?.message;
    if (err === 'invalid_grant') throw new OAuthError('invalid_grant', 'Gmail access was revoked or expired. Reconnect this account.');
    throw new OAuthError('other', `Could not refresh Gmail access (${err}).`);
  }
}

export async function revoke(refreshToken: string): Promise<void> {
  // Best effort: the token may already be revoked by the user.
  await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined);
}
