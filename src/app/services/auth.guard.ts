import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

async function waitForAuth(auth: AuthService): Promise<void> {
  await auth.ready;
}

export const authGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await waitForAuth(auth);
  if (!auth.user()) return router.createUrlTree(['/login']);
  return true;
};

export const pinGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await waitForAuth(auth);
  if (!auth.user()) return router.createUrlTree(['/login']);
  if (!auth.isRegistered()) return router.createUrlTree(['/setup-pin']);
  if (!auth.pinUnlocked()) return router.createUrlTree(['/unlock']);
  return true;
};