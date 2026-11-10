import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  Auth,
  GoogleAuthProvider,
  User,
  authState,
  createUserWithEmailAndPassword,
  getRedirectResult,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from '@angular/fire/auth';
import { Firestore, doc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Observable, catchError, distinctUntilChanged, map, of, shareReplay, switchMap } from 'rxjs';

/**
 * Single source of truth for "who is signed in".
 *
 * Every data service builds its Firestore queries from `forUser()`, so when the
 * user signs out or switches accounts, all live listeners are torn down and
 * re-created for the new uid. No uid is ever captured at construction time.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

  /** Emits the current Firebase user (or null) and replays it to late subscribers. */
  readonly user$: Observable<User | null> = authState(this.auth).pipe(
    distinctUntilChanged((a, b) => a?.uid === b?.uid),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Signal form for templates. */
  readonly user = toSignal(this.user$, { initialValue: null });

  constructor() {
    // Completes a signInWithRedirect() fallback after the page reloads.
    getRedirectResult(this.auth)
      .then(cred => (cred ? this.afterSignIn(cred.user) : undefined))
      .catch(err => console.warn('[AuthService] redirect sign-in failed', err?.code ?? err));
  }

  /** Resolves once Firebase has restored (or ruled out) a persisted session. */
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
   * Runs a per-user query. Emits `fallback` while signed out, and swallows
   * permission errors that can fire in the instant between sign-out and
   * listener teardown (otherwise one error would kill a shared stream forever).
   */
  forUser<T>(query: (uid: string) => Observable<T>, fallback: T): Observable<T> {
    return this.user$.pipe(
      map(u => u?.uid ?? null),
      distinctUntilChanged(),
      switchMap(uid =>
        uid
          ? query(uid).pipe(
              catchError(err => {
                // A 'failed-precondition' message contains the link to create a missing index.
                console.warn('[AuthService] query failed', err?.code ?? err, err?.message ?? '');
                return of(fallback);
              })
            )
          : of(fallback)
      )
    );
  }

  // ── Sign-in methods ──────────────────────────────────────────────

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const cred = await signInWithPopup(this.auth, provider);
      await this.afterSignIn(cred.user);
    } catch (err: any) {
      // Some mobile browsers block popups; fall back to a full-page redirect.
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(this.auth, provider);
        return;
      }
      throw err;
    }
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const cred = await signInWithEmailAndPassword(this.auth, email.trim().toLowerCase(), password);
    await this.afterSignIn(cred.user);
  }

  async signUpWithEmail(displayName: string, email: string, password: string): Promise<void> {
    const cred = await createUserWithEmailAndPassword(this.auth, email.trim().toLowerCase(), password);
    if (displayName.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    }
    // Non-blocking: verification is encouraged, not required, in Phase 2.
    sendEmailVerification(cred.user).catch(e => console.warn('Verification email failed', e));
    await this.afterSignIn(cred.user);
  }

  resetPassword(email: string): Promise<void> {
    return sendPasswordResetEmail(this.auth, email.trim().toLowerCase());
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
    await this.router.navigateByUrl('/login');
  }

  // ── Internals ────────────────────────────────────────────────────

  private async afterSignIn(user: User): Promise<void> {
    await this.upsertProfile(user);
    await this.router.navigateByUrl('/');
  }

  /** users/{uid} — holds profile now; FCM tokens and preferences in later phases. */
  private upsertProfile(user: User): Promise<void> {
    return setDoc(
      doc(this.firestore, 'users', user.uid),
      {
        uid: user.uid,
        email: (user.email ?? '').toLowerCase(),
        displayName: user.displayName ?? (user.email ?? '').split('@')[0],
        provider: user.providerData[0]?.providerId ?? 'password',
        lastLoginAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(err => {
      // Profile write failing must not block sign-in; surface it in the console.
      console.error('[AuthService] profile upsert failed', err);
    });
  }
}
