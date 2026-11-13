import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  AuthCredential,
  EmailAuthProvider,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  getRedirectResult,
  linkWithCredential,
  linkWithPopup,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  unlink,
  updatePassword,
  updateProfile,
  user as userChanges,
} from '@angular/fire/auth';
import { Firestore, deleteDoc, doc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Observable, catchError, distinctUntilChanged, map, of, shareReplay, switchMap } from 'rxjs';

/** Only @gmail.com identities are supported — for sign-in and for Gmail sync. */
export function isGmail(email: string | null | undefined): boolean {
  return /^[^@\s]+@gmail\.com$/i.test((email ?? '').trim());
}

/** A fresh, comparable snapshot of the signed-in account (Firebase reuses the same User object). */
export interface AccountSnapshot {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  /** 'password' | 'google.com' */
  providers: string[];
  googleEmail: string | null;
  createdAt: Date | null;
  /** Verified Gmail — the only state that may read or write data (enforced again in Firestore rules). */
  ready: boolean;
}

export class AuthFlowError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Single source of truth for "who is signed in".
 *
 * Account linking: Firebase's "one account per email address" setting (on by default) links
 * Google and password sign-in for the same verified @gmail.com address to ONE user id.
 * Google is the trusted provider for gmail.com, so if a password account's email is still
 * UNVERIFIED, a Google sign-in replaces that password — that's why email verification is
 * required before any data is accessible.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

  /** Fires on sign-in, sign-out AND token refresh (after verifying email, linking, renaming). */
  readonly user$: Observable<User | null> = userChanges(this.auth).pipe(
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly account = signal<AccountSnapshot | null>(null);

  /** Set when a data query fails (offline / missing index / server error); cleared by the shell banner. */
  readonly queryError = signal<'offline' | 'failed' | null>(null);

  /** Error from a redirect sign-in that finished after a page reload — shown on the login page. */
  readonly redirectError = signal<unknown>(null);

  /**
   * Google sign-in that Firebase refused because this Gmail already has a password account it
   * couldn't link automatically. Kept (in memory only) until the user signs in with the password once.
   */
  private pendingGoogle: { email: string; credential: AuthCredential } | null = null;

  constructor() {
    this.user$.subscribe(u => this.account.set(u ? this.snapshot(u) : null));
    // Completes a signInWithRedirect() fallback after the page reloads.
    getRedirectResult(this.auth)
      .then(cred => (cred ? this.afterSignIn(cred.user, !!getAdditionalUserInfo(cred)?.isNewUser) : undefined))
      .catch(err => {
        console.warn('[AuthService] redirect sign-in failed', err?.code ?? err);
        this.redirectError.set(this.rememberPendingGoogle(err) ?? err);
      });
  }

  /** Back-compat for templates/services that only need "is someone signed in". */
  user(): AccountSnapshot | null {
    return this.account();
  }

  ready(): Promise<void> {
    return this.auth.authStateReady();
  }

  /** Synchronous uid for writes. Throws if called while signed out. */
  requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to do that.');
    return uid;
  }

  /**
   * Runs a per-user query only for a verified Gmail account; emits `fallback` otherwise.
   * Swallows permission errors from the instant between sign-out and listener teardown.
   */
  forUser<T>(query: (uid: string) => Observable<T>, fallback: T): Observable<T> {
    return this.user$.pipe(
      map(u => (u && u.emailVerified && isGmail(u.email) ? u.uid : null)),
      distinctUntilChanged(),
      switchMap(uid =>
        uid
          ? query(uid).pipe(
              catchError(err => {
                // A 'failed-precondition' message contains the link to create a missing index.
                console.warn('[AuthService] query failed', err?.code ?? err, err?.message ?? '');
                // Surfaced by the app shell so a failed load is never shown as "no data".
                if (err?.code !== 'permission-denied') this.queryError.set(err?.code === 'unavailable' ? 'offline' : 'failed');
                return of(fallback);
              })
            )
          : of(fallback)
      )
    );
  }

  // ── Sign-in / sign-up ────────────────────────────────────────────

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    this.redirectError.set(null);
    try {
      const cred = await signInWithPopup(this.auth, provider);
      await this.afterSignIn(cred.user, !!getAdditionalUserInfo(cred)?.isNewUser);
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(this.auth, provider);
        return;
      }
      throw this.rememberPendingGoogle(err) ?? err;
    }
  }

  /** The Gmail waiting for a one-time password sign-in to finish linking Google (or null). */
  pendingGoogleEmail(): string | null {
    return this.pendingGoogle?.email ?? null;
  }

  /**
   * "An account already exists with the same email": keep Google's credential so the next password
   * sign-in for that Gmail links it — after that both buttons open the same account.
   */
  private rememberPendingGoogle(err: any): AuthFlowError | null {
    if (err?.code !== 'auth/account-exists-with-different-credential') return null;
    const credential = GoogleAuthProvider.credentialFromError(err);
    const email = (err?.customData?.email ?? '').toLowerCase();
    if (!credential || !email) return null;
    this.pendingGoogle = { email, credential };
    return new AuthFlowError(
      'link-google',
      `${email} already has a password. Sign in with it once below — Google will be linked, and next time either option works.`
    );
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    this.assertGmail(email);
    const cred = await signInWithEmailAndPassword(this.auth, email.trim().toLowerCase(), password);
    if (this.pendingGoogle && this.pendingGoogle.email === (cred.user.email ?? '').toLowerCase()) {
      const pending = this.pendingGoogle;
      this.pendingGoogle = null;
      // Best effort: signing in already worked; linking can also be done later from Profile.
      await linkWithCredential(cred.user, pending.credential).catch(e => console.warn('[AuthService] Google link failed', e?.code ?? e));
      await cred.user.getIdToken(true).catch(() => undefined);
    }
    await this.afterSignIn(cred.user, false);
  }

  async signUpWithEmail(displayName: string, email: string, password: string): Promise<void> {
    this.assertGmail(email);
    const cred = await createUserWithEmailAndPassword(this.auth, email.trim().toLowerCase(), password);
    if (displayName.trim()) await updateProfile(cred.user, { displayName: displayName.trim() });
    await this.sendVerification(cred.user);
    await this.router.navigateByUrl('/verify-email');
  }

  resetPassword(email: string): Promise<void> {
    this.assertGmail(email);
    return sendPasswordResetEmail(this.auth, email.trim().toLowerCase());
  }

  async logout(): Promise<void> {
    // Stop pushes to this device for the account that is leaving (a shared phone must not keep
    // receiving the previous user's alerts). Must run while still signed in.
    try {
      const deviceId = localStorage.getItem('ssb_push_device');
      if (deviceId) {
        await deleteDoc(doc(this.firestore, 'fcm_tokens', deviceId)).catch(() => undefined);
        localStorage.removeItem('ssb_push_device');
      }
    } catch { /* storage unavailable */ }
    await signOut(this.auth);
    await this.router.navigateByUrl('/login');
  }

  // ── Email verification ───────────────────────────────────────────

  async sendVerification(u: User | null = this.auth.currentUser): Promise<void> {
    if (!u) throw new AuthFlowError('no-user', 'Sign in first.');
    await sendEmailVerification(u, { url: `${location.origin}${location.pathname}#/verify-email` });
  }

  /** Re-reads the account; if now verified, refreshes the ID token so Firestore rules see it. */
  async checkVerified(): Promise<boolean> {
    const u = this.auth.currentUser;
    if (!u) return false;
    await u.reload();
    if (!u.emailVerified) return false;
    await u.getIdToken(true);
    await this.upsertProfile(u);
    return true;
  }

  // ── Profile & account management ─────────────────────────────────

  async updateDisplayName(name: string): Promise<void> {
    const u = this.mustUser();
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new AuthFlowError('invalid-name', 'Name cannot be empty.');
    await updateProfile(u, { displayName: clean });
    await setDoc(doc(this.firestore, 'users', u.uid), { uid: u.uid, displayName: clean, updatedAt: serverTimestamp() }, { merge: true });
    await u.getIdToken(true); // re-emit so the header updates
  }

  /** Change an existing password (re-authenticates with the current one first). */
  async changePassword(current: string, next: string): Promise<void> {
    const u = this.mustUser();
    this.assertStrong(next);
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, current));
    await updatePassword(u, next);
  }

  /** Add a password to a Google-only account (same uid, same data). */
  async setPassword(next: string): Promise<void> {
    const u = this.mustUser();
    this.assertStrong(next);
    try {
      await linkWithCredential(u, EmailAuthProvider.credential(u.email!, next));
    } catch (e: any) {
      if (e?.code === 'auth/requires-recent-login') {
        await this.reauthWithGoogle();
        await linkWithCredential(u, EmailAuthProvider.credential(u.email!, next));
      } else throw e;
    }
    await u.getIdToken(true);
  }

  /** Link Google to a password account. Rejects a Google account with a different address. */
  async linkGoogle(): Promise<void> {
    const u = this.mustUser();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ login_hint: u.email ?? '', prompt: 'select_account' });
    const res = await linkWithPopup(u, provider);
    const g = res.user.providerData.find(p => p.providerId === 'google.com');
    if ((g?.email ?? '').toLowerCase() !== (u.email ?? '').toLowerCase()) {
      await unlink(res.user, 'google.com');
      throw new AuthFlowError('google-mismatch', `Pick the Google account for ${u.email}. A different Gmail address can't be linked.`);
    }
    await res.user.getIdToken(true);
  }

  async unlinkProvider(providerId: 'google.com' | 'password'): Promise<void> {
    const u = this.mustUser();
    if (u.providerData.length < 2) throw new AuthFlowError('last-method', 'Keep at least one sign-in method.');
    await unlink(u, providerId);
    await u.getIdToken(true);
  }

  async reauthWithGoogle(): Promise<void> {
    const u = this.mustUser();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ login_hint: u.email ?? '' });
    await reauthenticateWithPopup(u, provider);
  }

  // ── Internals ────────────────────────────────────────────────────

  private async afterSignIn(user: User, isNew: boolean): Promise<void> {
    if (!isGmail(user.email)) {
      // A non-Gmail Google account (e.g. Workspace) was used. Remove a just-created account; sign out otherwise.
      if (isNew) await user.delete().catch(() => signOut(this.auth));
      else await signOut(this.auth);
      throw new AuthFlowError('not-gmail', 'Only @gmail.com accounts are supported. Choose your Gmail account.');
    }
    if (!user.emailVerified) {
      await this.router.navigateByUrl('/verify-email');
      return;
    }
    await this.upsertProfile(user);
    await this.router.navigateByUrl('/');
  }

  /** users/{uid} — profile document (rules require a verified Gmail token). */
  private upsertProfile(user: User): Promise<void> {
    return setDoc(
      doc(this.firestore, 'users', user.uid),
      {
        uid: user.uid,
        email: (user.email ?? '').toLowerCase(),
        displayName: user.displayName ?? (user.email ?? '').split('@')[0],
        providers: user.providerData.map(p => p.providerId),
        lastLoginAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(err => console.error('[AuthService] profile upsert failed', err));
  }

  private snapshot(u: User): AccountSnapshot {
    const providers = u.providerData.map(p => p.providerId);
    return {
      uid: u.uid,
      email: (u.email ?? '').toLowerCase(),
      displayName: u.displayName ?? '',
      emailVerified: u.emailVerified,
      providers,
      googleEmail: u.providerData.find(p => p.providerId === 'google.com')?.email ?? null,
      createdAt: u.metadata.creationTime ? new Date(u.metadata.creationTime) : null,
      ready: u.emailVerified && isGmail(u.email),
    };
  }

  private mustUser(): User {
    const u = this.auth.currentUser;
    if (!u) throw new AuthFlowError('no-user', 'Sign in first.');
    return u;
  }

  private assertGmail(email: string): void {
    if (!isGmail(email)) throw new AuthFlowError('not-gmail', 'Use your @gmail.com address. Other email providers are not supported.');
  }

  private assertStrong(pw: string): void {
    if ((pw ?? '').length < 8) throw new AuthFlowError('weak-password', 'Use at least 8 characters.');
  }
}

/** Friendly messages for Firebase Auth + our own flow errors. */
export function authMessage(err: any): string {
  if (err instanceof AuthFlowError) return err.message;
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect. If you registered with Google, use "Continue with Google" and add a password in Profile.';
    case 'auth/email-already-in-use':
      return 'This Gmail already has an account. Sign in (with Google or your password) — both open the same account.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google window closed before sign-in finished. Try again; if it keeps happening, use your password and tell us.';
    case 'auth/account-exists-with-different-credential':
      return 'This Gmail already has a password account. Sign in with the password once, then link Google in Profile.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/web-storage-unsupported':
      return 'This browser is blocking storage that sign-in needs. Turn off private/incognito mode or try Chrome.';
    case 'auth/internal-error':
      return 'Google sign-in failed inside the browser. Reload the page and try again.';
    case 'auth/requires-recent-login':
      return 'For security, sign in again and then retry.';
    case 'auth/credential-already-in-use':
      return 'That Google account is already used by another SmartShare account.';
    case 'auth/provider-already-linked':
      return 'This sign-in method is already linked.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorised in Firebase Authentication settings.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in the Firebase console.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    default:
      // Keep the code visible: it's what tells us what actually went wrong.
      return `Something went wrong. Please try again.${err?.code ? ` (${err.code})` : ''}`;
  }
}
