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
  // Basic info
  username = 'Karthik';
  today = new Date();

  // Month stats
  completionPercent = 0;
  remainingDays = 0;

  totalIncome = 0;
  totalExpenses = 0;
  availableBalance = 0;
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

  months: { label: string; value: string }[] = [];
  selectedMonth!: string;

  ngOnInit() {
    this.generateMonths();
      this.selectedMonth = this.getCurrentMonth();
      this.calculateMonthStats();
      this.loadData();
      this.loadMonthlyFinance();
  }

  generateMonths() {
    const currentYear = this.today.getFullYear();

    for (let y = currentYear - 1; y <= currentYear + 1; y++) {
      for (let m = 0; m < 12; m++) {
        const date = new Date(y, m);
        this.months.push({
          label: date.toLocaleString('default', { month: 'long', year: 'numeric' }),
          value: `${y}-${String(m + 1).padStart(2, '0')}`
        });
      }
    }
  }

  getCurrentMonth(): string {
    const y = this.today.getFullYear();
    const m = String(this.today.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }


  calculateMonthStats() {
    const [year, month] = this.selectedMonth.split('-').map(Number);

    const totalDays = new Date(year, month, 0).getDate();
    const today = new Date();

    const isCurrentMonth =
      year === today.getFullYear() &&
      month === today.getMonth() + 1;

    if (isCurrentMonth) {
      const todayDate = today.getDate();
      this.completionPercent = Math.round((todayDate / totalDays) * 100);
      this.remainingDays = totalDays - todayDate;
    } else if (
      new Date(year, month - 1) < new Date(today.getFullYear(), today.getMonth())
    ) {
      // Past month
      this.completionPercent = 100;
      this.remainingDays = 0;
    } else {
      // Future month
      this.completionPercent = 0;
      this.remainingDays = totalDays;
    }
  }

  onMonthChange() {
    this.calculateMonthStats();
    this.loadMonthlyFinance();
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

  getSelectedMonthKey(): string {
    const monthIndex = this.months.findIndex(m => m.value === this.selectedMonth);
    return monthIndex !== -1 ? this.months[monthIndex].value : this.selectedMonth;
  }

  loadMonthlyFinance() {
    const monthKey = this.getSelectedMonthKey();

    // Income
    this.incomeService.getIncomeByMonth(monthKey)
      .subscribe((data: any[]) => {
        this.totalIncome = data.reduce((sum, i) => sum + i.amount, 0);
        this.calculateBalance();
      });

    // Expenses
    this.expenseService.getExpensesByMonth(monthKey)
      .subscribe((data: any[]) => {
        this.totalExpenses = data.reduce((sum, e) => sum + e.amount, 0);
        this.calculateBalance();
      });
  }

  calculateBalance() {
    this.availableBalance = this.totalIncome - this.totalExpenses;
  }

}
