import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BudgetInputComponent } from './components/budget-input/budget-input.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';

const routes: Routes = [
  { path: '', redirectTo: 'new', pathMatch: 'full' },
  { path: 'new', component: BudgetInputComponent },
  { path: 'dashboard', component: DashboardComponent },
  { path: '**', redirectTo: 'new' },
];

@NgModule({ imports: [RouterModule.forRoot(routes)], exports: [RouterModule] })
export class AppRoutingModule {}