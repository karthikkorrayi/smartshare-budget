import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { Firestore, collection, collectionData, doc, query, updateDoc, where } from '@angular/fire/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { GmailConnection, MONITOR_GROUPS, MonitorGroup, SyncStats } from '../models/gmail.model';
import { toDate } from '../utils/firestore.util';
import { environment } from '../../environments/environment';

declare const google: any;

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.readonly';

/**
 * Google Mail Integration (client side).
 * The browser only obtains a one-time authorization code from Google's consent popup;
 * the Cloud Function exchanges it and keeps the refresh token encrypted server-side.
 * The browser never sees or stores a Gmail token.
 */
@Injectable({ providedIn: 'root' })
export class GmailService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private app = inject(FirebaseApp);
  private col = collection(this.firestore, 'gmail_connections');
  private gisLoading?: Promise<void>;

  /** A real OAuth client ID — never a client secret ("GOCSPX-…") or the placeholder. */
  readonly configured = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(environment.gmailOAuthClientId ?? '');
  readonly misconfiguredWithSecret = /^GOCSPX-/i.test(environment.gmailOAuthClientId ?? '');

  readonly connections$: Observable<GmailConnection[]> = this.auth
    .forUser(
      uid =>
        collectionData(query(this.col, where('userId', '==', uid)), { idField: 'id' }).pipe(
          map(docs => docs.map(d => GmailService.fromFirestore(d)).sort((a, b) => a.email.localeCompare(b.email)))
        ),
      [] as GmailConnection[]
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  private fn<Req, Res>(name: string) {
    return httpsCallable<Req, Res>(getFunctions(this.app, environment.functionsRegion), name, { timeout: 180_000 });
  }

  /** Opens Google's consent popup (Gmail read-only), then hands the code to the server. */
  async connect(backfillDays: number, groups: MonitorGroup[], loginHint?: string): Promise<{ email: string; stats: SyncStats | null }> {
    if (!this.configured) throw new Error('Gmail integration is not configured: environment.gmailOAuthClientId must be the OAuth client ID ending in .apps.googleusercontent.com.');
    await this.loadGis();
    const code = await new Promise<string>((resolve, reject) => {
      const client = google.accounts.oauth2.initCodeClient({
        client_id: environment.gmailOAuthClientId,
        scope: SCOPES,
        ux_mode: 'popup',
        // 'consent' guarantees a refresh token even when this Gmail was connected before.
        prompt: 'consent select_account',
        ...(loginHint ? { login_hint: loginHint } : {}),
        callback: (resp: any) => (resp?.code ? resolve(resp.code) : reject(new Error(resp?.error_description || resp?.error || 'Consent was not completed.'))),
        error_callback: (e: any) => reject(new Error(e?.type === 'popup_closed' ? 'The Google window was closed.' : e?.type === 'popup_failed_to_open' ? 'Allow pop-ups for this site and try again.' : 'Google consent failed.')),
      });
      client.requestCode();
    });
    const res = await this.fn<{ code: string; backfillDays: number; groups: MonitorGroup[] }, { email: string; stats: SyncStats | null }>(
      'gmailConnect'
    )({ code, backfillDays, groups });
    return res.data;
  }

  async syncNow(connectionId: string): Promise<SyncStats> {
    const res = await this.fn<{ connectionId: string }, { stats: SyncStats }>('gmailSyncNow')({ connectionId });
    return res.data.stats;
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.fn<{ connectionId: string }, { ok: boolean }>('gmailDisconnect')({ connectionId });
  }

  setPaused(c: GmailConnection, paused: boolean) {
    return updateDoc(doc(this.firestore, 'gmail_connections', c.id), { paused });
  }

  setGroups(c: GmailConnection, groups: MonitorGroup[]) {
    const clean = MONITOR_GROUPS.filter(g => groups.includes(g));
    return updateDoc(doc(this.firestore, 'gmail_connections', c.id), { groups: clean });
  }

  private loadGis(): Promise<void> {
    if (typeof google !== 'undefined' && google?.accounts?.oauth2) return Promise.resolve();
    this.gisLoading ??= new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        this.gisLoading = undefined;
        reject(new Error('Could not load Google sign-in. Check your connection or content blockers.'));
      };
      document.head.appendChild(s);
    });
    return this.gisLoading;
  }

  static fromFirestore(d: any): GmailConnection {
    return {
      id: d.id,
      userId: d.userId,
      email: d.email ?? '',
      status: d.status ?? 'error',
      paused: !!d.paused,
      groups: Array.isArray(d.groups) ? d.groups : [...MONITOR_GROUPS],
      backfillDays: Number(d.backfillDays) || 30,
      createdAt: toDate(d.createdAt),
      lastSyncAt: toDate(d.lastSyncAt),
      lastRunAt: toDate(d.lastRunAt),
      lastRunStats: d.lastRunStats ?? null,
      lastError: d.lastError ?? null,
      backfillInProgress: !!d.cursor,
    };
  }
}

/** Friendly text for callable errors. */
export function gmailMessage(err: any): string {
  const msg = err?.message ?? '';
  switch (err?.code) {
    case 'functions/failed-precondition':
    case 'functions/aborted':
    case 'functions/not-found':
    case 'functions/permission-denied':
      return msg;
    case 'functions/unauthenticated':
      return 'Sign in again and retry.';
    case 'functions/unavailable':
    case 'functions/deadline-exceeded':
      return 'The server took too long. Monitoring continues in the background — check back shortly.';
    case 'functions/not-found-function':
    case 'functions/internal':
      return msg && msg !== 'internal' ? msg : 'Server error. Make sure the Gmail functions are deployed.';
    default:
      return msg || 'Something went wrong.';
  }
}
