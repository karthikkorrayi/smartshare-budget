import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IncomeService } from '../../services/income.service';
import { ExpenseService } from '../../services/expense.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2>Dashboard</h2>

    <p>Total Income: ₹{{ totalIncome }}</p>
    <p>Total Expenses: ₹{{ totalExpenses }}</p>
    <p>Balance: ₹{{ totalIncome - totalExpenses }}</p>
  `
})
export class DashboardComponent {
  totalIncome = 0;
  totalExpenses = 0;

  constructor(
    incomeService: IncomeService,
    expenseService: ExpenseService
  ) {
    incomeService.getIncome().subscribe((data: any[]) => {
      this.totalIncome = data.reduce((sum, i) => sum + i.amount, 0);
    });

    expenseService.getExpenses().subscribe((data: any[]) => {
      this.totalExpenses = data.reduce((sum, e) => sum + e.amount, 0);
    });
  }
}
