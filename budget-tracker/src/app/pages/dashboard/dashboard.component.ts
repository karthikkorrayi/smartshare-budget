import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { IncomeService } from '../../services/income.service';
import { ExpenseService } from '../../services/expense.service';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: `
    <h2>Dashboard</h2>

    <p>Total Income: ₹{{ totalIncome }}</p>
    <p>Total Expenses: ₹{{ totalExpenses }}</p>
    <p>Balance: ₹{{ totalIncome - totalExpenses }}</p>
  `,
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  totalIncome = 0;
  totalExpenses = 0;

  constructor(
    incomeService: IncomeService,
    expenseService: ExpenseService
  ) {
    incomeService.getIncome().subscribe((data: any[]) => {
      this.totalIncome = data.reduce((a, b) => a + b.amount, 0);
    });

    expenseService.getExpenses().subscribe((data: any[]) => {
      this.totalExpenses = data.reduce((a, b) => a + b.amount, 0);
    });
  }

}
