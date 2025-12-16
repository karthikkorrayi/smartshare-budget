import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { IncomeComponent } from './pages/income/income.component';
import { ExpensesComponent } from './pages/expenses/expenses.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'income', component: IncomeComponent },
  { path: 'expenses', component: ExpensesComponent }
];
