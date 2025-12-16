import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IncomeService } from '../../services/income.service';
import { ExpenseService } from '../../services/expense.service';
import { getCurrentMonth } from '../../utils/date.util';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatProgressBarModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  totalIncome = 0;
  totalExpenses = 0;
  incomeService: IncomeService;
  expenseService: ExpenseService;

  constructor(
    incomeService: IncomeService,
    expenseService: ExpenseService
  ) {
    this.incomeService = incomeService;
    this.expenseService = expenseService;
    incomeService.getIncome().subscribe((data: any[]) => {
      this.totalIncome = data.reduce((sum, i) => sum + i.amount, 0);
    });

    expenseService.getExpenses().subscribe((data: any[]) => {
      this.totalExpenses = data.reduce((sum, e) => sum + e.amount, 0);
    });
  }

  selectedMonth = getCurrentMonth();
  months: string[] = [];

ngOnInit() {
  this.generateMonths();
  this.loadData();
}

generateMonths() {
  const currentYear = new Date().getFullYear();
  for (let m = 1; m <= 12; m++) {
    this.months.push(`${currentYear}-${String(m).padStart(2, '0')}`);
  }
}

loadData() {
  this.incomeService.getIncomeByMonth(this.selectedMonth)
    .subscribe((data: any[]) => {
      this.totalIncome = data.reduce((a, b) => a + b.amount, 0);
    });

  this.expenseService.getExpensesByMonth(this.selectedMonth)
    .subscribe((data: any[]) => {
      this.totalExpenses = data.reduce((a, b) => a + b.amount, 0);
    });
}
}
