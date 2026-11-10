import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { IncomeComponent } from './pages/income/income.component';
import { ExpensesComponent } from './pages/expenses/expenses.component';
import { LoginComponent } from './security/login/login.component';
import { authGuard, guestGuard } from './security/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'income', component: IncomeComponent, canActivate: [authGuard] },
  { path: 'expenses', component: ExpensesComponent, canActivate: [authGuard] },

  // Credit card module — lazy-loaded so it doesn't grow the initial bundle.
  {
    path: 'cards',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/cards/cards-shell.component').then(m => m.CardsShellComponent),
    children: [
      { path: '', loadComponent: () => import('./pages/cards/cards-list/cards-list.component').then(m => m.CardsListComponent) },
      { path: 'transactions', loadComponent: () => import('./pages/cards/transactions/transactions.component').then(m => m.TransactionsComponent) },
      { path: 'statements', loadComponent: () => import('./pages/cards/statements/statements.component').then(m => m.StatementsComponent) },
      { path: 'review', loadComponent: () => import('./pages/cards/review/review.component').then(m => m.ReviewComponent) },
    ],
  },
  {
    path: 'notifications',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/notifications/notifications.component').then(m => m.NotificationsComponent),
  },
  { path: '**', redirectTo: '' },
];
