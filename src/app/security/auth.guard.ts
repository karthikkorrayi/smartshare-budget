import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Auth, signOut } from '@angular/fire/auth';
import { isGmail } from '../services/auth.service';

/**
 * App routes need a VERIFIED @gmail.com account (the same rule Firestore enforces).
 * `authStateReady()` avoids bouncing a signed-in user to /login on refresh.
 */
export const authGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.authStateReady();
  const u = auth.currentUser;
  if (!u) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  if (!isGmail(u.email)) {
    await signOut(auth);
    return router.createUrlTree(['/login']);
  }
  if (!u.emailVerified) return router.createUrlTree(['/verify-email']);
  return true;
};

/** Keeps signed-in users away from /login. */
export const guestGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.authStateReady();
  const u = auth.currentUser;
  if (!u || !isGmail(u.email)) return true;
  return router.createUrlTree([u.emailVerified ? '/' : '/verify-email']);
};

/** /verify-email: only for signed-in, not-yet-verified Gmail accounts. */
export const verifyGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.authStateReady();
  const u = auth.currentUser;
  if (!u) return router.createUrlTree(['/login']);
  return u.emailVerified ? router.createUrlTree(['/']) : true;
};
