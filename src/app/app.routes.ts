import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { IncomeComponent } from './pages/income/income.component';
import { ExpensesComponent } from './pages/expenses/expenses.component';
import { LoginComponent } from './pages/auth/login.component';
import { SetupPinComponent } from './pages/auth/setup-pin.component';
import { UnlockComponent } from './pages/auth/unlock.component';
import { ForgotPinComponent } from './pages/auth/forgot-pin.component';
import { ResetPinComponent } from './pages/auth/reset-pin.component';
import { authGuard, pinGuard } from './services/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'login', component: LoginComponent },
  { path: 'setup-pin', component: SetupPinComponent, canActivate: [authGuard] },
  { path: 'unlock', component: UnlockComponent, canActivate: [authGuard] },
  { path: 'forgot-pin', component: ForgotPinComponent },
  { path: 'reset-pin/:token', component: ResetPinComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [pinGuard] },
  { path: 'income', component: IncomeComponent, canActivate: [pinGuard] },
  { path: 'expenses', component: ExpensesComponent, canActivate: [pinGuard] },
  { path: '**', redirectTo: 'dashboard' }
];