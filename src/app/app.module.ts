import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { BudgetInputComponent } from './components/budget-input/budget-input.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';

// Angular Material
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';

// Charts
import { NgxEchartsModule } from 'ngx-echarts';

@NgModule({
  declarations: [AppComponent, BudgetInputComponent, DashboardComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    FormsModule,
    ReactiveFormsModule,
    AppRoutingModule,
    // Material
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatToolbarModule,
    MatCardModule,
    // Charts
    NgxEchartsModule.forRoot({ echarts: () => import('echarts') }),
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}