import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';
import { TargetWizardComponent } from './components/target-wizard/target-wizard.component';
import { TargetDashboardComponent } from './components/target-dashboard/target-dashboard.component';
import { LoanWizardComponent } from './components/loan-wizard/loan-wizard.component';
import { LoanDashboardComponent } from './components/loan-dashboard/loan-dashboard.component';
import { TripWizardComponent } from './components/trip-wizard/trip-wizard.component';
import { TripDashboardComponent } from './components/trip-dashboard/trip-dashboard.component';
import { SavingsWizardComponent } from './components/savings-wizard/savings-wizard.component';
import { SavingsDashboardComponent } from './components/savings-dashboard/savings-dashboard.component';
import { ExpensesBoardComponent } from './components/expenses-board/expenses-board.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },

  // Product Target
  { path: 'target/new', component: TargetWizardComponent },
  { path: 'target/:id/edit', component: TargetWizardComponent },
  { path: 'target/:id', component: TargetDashboardComponent },

  // Loan or EMI
  { path: 'loan/new', component: LoanWizardComponent },
  { path: 'loan/:id/edit', component: LoanWizardComponent },
  { path: 'loan/:id', component: LoanDashboardComponent },

  // Trip
  { path: 'trip/new', component: TripWizardComponent },
  { path: 'trip/:id/edit', component: TripWizardComponent },
  { path: 'trip/:id', component: TripDashboardComponent },

  // Savings
  { path: 'savings', redirectTo: 'savings/new', pathMatch: 'full' },
  { path: 'savings/new', component: SavingsWizardComponent },
  { path: 'savings/:id/edit', component: SavingsWizardComponent },
  { path: 'savings/:id', component: SavingsDashboardComponent },

  // Expenses
  { path: 'expenses', component: ExpensesBoardComponent },

  { path: '**', redirectTo: '' },
];