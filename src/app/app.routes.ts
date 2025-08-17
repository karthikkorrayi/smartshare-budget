import { Routes } from '@angular/router';
import { TargetWizardComponent } from './components/target-wizard/target-wizard.component';
import { TargetDashboardComponent } from './components/target-dashboard/target-dashboard.component';
import { HomeComponent } from './components/home/home.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'target/new', component: TargetWizardComponent },
  { path: 'target/:id', component: TargetDashboardComponent },
  { path: 'target/:id/edit', component: TargetWizardComponent },
  { path: '**', redirectTo: '' }
];