import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Auth } from '@angular/fire/auth';

/**
 * Blocks financial routes until Firebase has restored the session.
 * `authStateReady()` avoids the classic bug where a refresh briefly sees
 * `currentUser === null` and bounces a signed-in user to /login.
 */
export const authGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.authStateReady();
  if (auth.currentUser) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Keeps signed-in users away from /login. */
export const guestGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.authStateReady();
  return auth.currentUser ? router.createUrlTree(['/']) : true;
};
