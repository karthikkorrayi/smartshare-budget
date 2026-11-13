import { Routes } from '@angular/router';
import { LoginComponent } from './security/login/login.component';
import { authGuard, guestGuard, verifyGuard } from './security/auth.guard';
import { ShellComponent } from './layout/shell.component';

/**
 * Hash-based URLs are unchanged from before (#/, #/cards, #/review, …) so bookmarks and
 * push-notification links keep working. Signed-in pages render inside the app shell.
 */
export const routes: Routes = [
  // ── Signed-out pages (no shell) ────────────────────────────────
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  {
    path: 'verify-email',
    canActivate: [verifyGuard],
    loadComponent: () => import('./security/verify-email/verify-email.component').then(m => m.VerifyEmailComponent),
  },

  // ── Application ────────────────────────────────────────────────
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', data: { title: 'Dashboard' }, loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      {
        path: 'account/:type/:id',
        data: { title: 'Account' },
        loadComponent: () => import('./pages/account-detail/account-detail.component').then(m => m.AccountDetailComponent),
      },
      { path: 'recurring', data: { title: 'Recurring payments' }, loadComponent: () => import('./pages/recurring/recurring.component').then(m => m.RecurringComponent) },
      {
        path: 'review',
        data: { title: 'Review' },
        loadComponent: () => import('./pages/review-shell/review-shell.component').then(m => m.ReviewShellComponent),
        children: [
          { path: '', loadComponent: () => import('./pages/activity/activity.component').then(m => m.ActivityComponent) },
          { path: 'inbox', data: { title: 'Review · Email inbox' }, loadComponent: () => import('./pages/review/review.component').then(m => m.ReviewComponent) },
        ],
      },
      // Old standalone pages / links land on the new homes.
      { path: 'income', redirectTo: 'review' },
      { path: 'expenses', redirectTo: 'review' },
      {
        path: 'cards',
        loadComponent: () => import('./pages/cards/cards-shell.component').then(m => m.CardsShellComponent),
        children: [
          { path: '', data: { title: 'Credit cards' }, loadComponent: () => import('./pages/cards/cards-list/cards-list.component').then(m => m.CardsListComponent) },
          { path: 'transactions', data: { title: 'Card transactions' }, loadComponent: () => import('./pages/cards/transactions/transactions.component').then(m => m.TransactionsComponent) },
          { path: 'statements', data: { title: 'Card statements' }, loadComponent: () => import('./pages/cards/statements/statements.component').then(m => m.StatementsComponent) },
          { path: 'wallets', data: { title: 'Wallets' }, loadComponent: () => import('./pages/cards/wallets/wallets.component').then(m => m.WalletsComponent) },
          { path: 'review', redirectTo: '/review/inbox' },
        ],
      },
      { path: 'gmail', data: { title: 'Gmail sync' }, loadComponent: () => import('./pages/gmail/gmail.component').then(m => m.GmailComponent) },
      { path: 'notifications', data: { title: 'Notifications' }, loadComponent: () => import('./pages/notifications/notifications.component').then(m => m.NotificationsComponent) },
      { path: 'profile', data: { title: 'Profile & settings' }, loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
