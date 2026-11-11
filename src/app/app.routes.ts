import { Routes } from '@angular/router';
import { LoginComponent } from './security/login/login.component';
import { authGuard, guestGuard, verifyGuard } from './security/auth.guard';

export const routes: Routes = [
  // ── Profile & Account ───────────────────────────────────────────
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  {
    path: 'verify-email',
    canActivate: [verifyGuard],
    loadComponent: () => import('./security/verify-email/verify-email.component').then(m => m.VerifyEmailComponent),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent),
  },

  // ── Financial modules ───────────────────────────────────────────
  // Lazy-loaded (Phase 6) to keep the first download small.
  { path: '', canActivate: [authGuard], loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'income', canActivate: [authGuard], loadComponent: () => import('./pages/income/income.component').then(m => m.IncomeComponent) },
  { path: 'expenses', canActivate: [authGuard], loadComponent: () => import('./pages/expenses/expenses.component').then(m => m.ExpensesComponent) },
  {
    path: 'cards',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/cards/cards-shell.component').then(m => m.CardsShellComponent),
    children: [
      { path: '', loadComponent: () => import('./pages/cards/cards-list/cards-list.component').then(m => m.CardsListComponent) },
      { path: 'transactions', loadComponent: () => import('./pages/cards/transactions/transactions.component').then(m => m.TransactionsComponent) },
      { path: 'statements', loadComponent: () => import('./pages/cards/statements/statements.component').then(m => m.StatementsComponent) },
      { path: 'review', redirectTo: '/review' }, // old Phase A link
    ],
  },

  // ── Google Mail Integration + centralized Review Center ─────────
  {
    path: 'gmail',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/gmail/gmail.component').then(m => m.GmailComponent),
  },
  {
    path: 'review',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/review/review.component').then(m => m.ReviewComponent),
  },
  {
    path: 'notifications',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/notifications/notifications.component').then(m => m.NotificationsComponent),
  },
  { path: '**', redirectTo: '' },
];
