import { defineSecret, defineString } from 'firebase-functions/params';

/** Mumbai — closest region to the users. */
export const REGION = 'asia-south1';

/** OAuth 2.0 Web client ID used for the Gmail consent popup (not secret; prompted on first deploy). */
export const GMAIL_CLIENT_ID = defineString('GMAIL_CLIENT_ID', {
  description: 'OAuth 2.0 Web client ID used for the Gmail consent popup',
});

/** OAuth client secret. Set with: firebase functions:secrets:set GMAIL_CLIENT_SECRET */
export const GMAIL_CLIENT_SECRET = defineSecret('GMAIL_CLIENT_SECRET');

/** 32-byte base64 key for AES-256-GCM token encryption. Set with: firebase functions:secrets:set TOKEN_ENC_KEY */
export const TOKEN_ENC_KEY = defineSecret('TOKEN_ENC_KEY');

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** Per-run safety limits. */
export const MAX_MESSAGES_PER_RUN = 120;
export const RUN_TIME_BUDGET_MS = 4 * 60 * 1000;
export const ALLOWED_BACKFILL_DAYS = [7, 30, 90];
