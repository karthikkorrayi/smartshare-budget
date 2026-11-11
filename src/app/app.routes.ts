import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { IncomeComponent } from './pages/income/income.component';
import { ExpensesComponent } from './pages/expenses/expenses.component';
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
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'income', component: IncomeComponent, canActivate: [authGuard] },
  { path: 'expenses', component: ExpensesComponent, canActivate: [authGuard] },
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
