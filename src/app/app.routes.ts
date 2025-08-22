import { Routes } from '@angular/router';
import { TargetWizardComponent } from './components/target-wizard/target-wizard.component';
import { TargetDashboardComponent } from './components/target-dashboard/target-dashboard.component';
import { HomeComponent } from './components/home/home.component';
import { LoanWizardComponent } from './components/loan-wizard/loan-wizard.component';
import { LoanDashboardComponent } from './components/loan-dashboard/loan-dashboard.component';
import { TripWizardComponent } from './components/trip-wizard/trip-wizard.component';
import { TripDashboardComponent } from './components/trip-dashboard/trip-dashboard.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },

  // Product target
  { path: 'target/new', component: TargetWizardComponent },
  { path: 'target/:id', component: TargetDashboardComponent },
  { path: 'target/:id/edit', component: TargetWizardComponent },

  // Loan or EMI
  { path: 'loan/new', component: LoanWizardComponent },
  { path: 'loan/:id', component: LoanDashboardComponent },
  { path: 'loan/:id/edit', component: LoanWizardComponent },

  // Trip
  { path: 'trip/new', component: TripWizardComponent },
  { path: 'trip/:id', component: TripDashboardComponent },
  { path: 'trip/:id/edit', component: TripWizardComponent },
  { path: '**', redirectTo: '' }
];