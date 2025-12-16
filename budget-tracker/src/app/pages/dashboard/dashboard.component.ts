import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IncomeService } from '../../services/income.service';
import { ExpenseService } from '../../services/expense.service';
import { getCurrentMonth } from '../../utils/date.util';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

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

  barChart!: Chart;
  dailyTotals: number[] = [];

  gaugeChart!: Chart;
  gaugeCategory = '';
  gaugeSpent = 0;
  gaugeLimit = 50000; // static for now

  recentExpenses: any[] = [];

  lineChart!: Chart;

  thisMonthCumulative: number[] = [];
  lastMonthCumulative: number[] = [];

  categorySummary: {
    name: string;
    amount: number;
    percentage: number;
  }[] = [];

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
    const lastMonthKey = this.getLastMonthKey();

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
        this.prepareDailyExpenses(data);
        this.prepareCategorySummary(data);
        this.prepareRecentExpenses(data);
        this.thisMonthCumulative =
          this.prepareCumulativeData(data, monthKey);

        this.renderLineChart();
      });

      this.expenseService.getExpensesByMonth(lastMonthKey)
      .subscribe((data: any[]) => {
        this.lastMonthCumulative =
          this.prepareCumulativeData(data, lastMonthKey);

        this.renderLineChart();
      });
  }

  calculateBalance() {
    this.availableBalance = this.totalIncome - this.totalExpenses;
  }

  prepareDailyExpenses(expenses: any[]) {
    const year = this.today.getFullYear();
    const monthIndex = this.months.findIndex(m => m.value === this.selectedMonth);

    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    this.dailyTotals = new Array(daysInMonth).fill(0);

    expenses.forEach(exp => {
      const day = new Date(exp.date.seconds * 1000).getDate();
      this.dailyTotals[day - 1] += exp.amount;
    });

    this.renderBarChart(daysInMonth);
  }

  renderBarChart(daysInMonth: number) {
    const labels = Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString());
    const todayDate = this.today.getDate();

    const backgroundColors = this.dailyTotals.map((_, index) =>
      index + 1 === todayDate ? '#1e88e5' : '#bbdefb'
    );

    if (this.barChart) {
      this.barChart.destroy();
    }

    this.barChart = new Chart('monthlyBarChart', {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: this.dailyTotals,
          backgroundColor: backgroundColors,
          borderRadius: 6,
          maxBarThickness: 20
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `₹ ${ctx.raw}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: '#e0e0e0'
            }
          }
        }
      }
    });
  }

  prepareCategorySummary(expenses: any[]) {
    const categoryMap: any = {};

    expenses.forEach(exp => {
      const cat = exp.category || 'Others';
      categoryMap[cat] = (categoryMap[cat] || 0) + exp.amount;
    });

    const maxAmount = Math.max(...(Object.values(categoryMap) as number[]));

    this.categorySummary = Object.keys(categoryMap).map(cat => ({
      name: cat,
      amount: categoryMap[cat],
      percentage: Math.round((categoryMap[cat] / maxAmount) * 100)
    }));
    this.categorySummary.sort((a, b) => b.amount - a.amount);
    this.prepareCategoryGauge();

  }

  prepareCategoryGauge() {
    if (!this.categorySummary.length) return;

    // pick highest spending category
    const topCategory = this.categorySummary[0];
    this.gaugeCategory = topCategory.name;
    this.gaugeSpent = topCategory.amount;

    this.renderGaugeChart();
  }

  renderGaugeChart() {
    const used = this.gaugeSpent;
    const remaining = Math.max(this.gaugeLimit - used, 0);

    if (this.gaugeChart) {
      this.gaugeChart.destroy();
    }

    this.gaugeChart = new Chart('categoryGauge', {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [used, remaining],
          backgroundColor: ['#1e88e5', '#e0e0e0'],
          borderWidth: 0
        }]
      },
      options: {
        circumference: 180,
        rotation: -90,
        cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `₹ ${ctx.raw}`
            }
          }
        }
      }
    });
  }

  prepareRecentExpenses(expenses: any[]) {
    this.recentExpenses = [...expenses]
      .sort((a, b) => {
        const da = new Date(a.date.seconds * 1000).getTime();
        const db = new Date(b.date.seconds * 1000).getTime();
        return db - da;
      })
      .slice(0, 5);
  }

  getLastMonthKey(): string {
    const year = this.today.getFullYear();
    const monthIndex = this.months.findIndex(m => m.value === this.selectedMonth);

    const date = new Date(year, monthIndex - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  prepareCumulativeData(expenses: any[], monthKey: string): number[] {
    const [year, month] = monthKey.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    const dailyTotals = new Array(daysInMonth).fill(0);

    expenses.forEach(exp => {
      const day = new Date(exp.date.seconds * 1000).getDate();
      dailyTotals[day - 1] += exp.amount;
    });

    // convert to cumulative
    for (let i = 1; i < dailyTotals.length; i++) {
      dailyTotals[i] += dailyTotals[i - 1];
    }

    return dailyTotals;
  }

  renderLineChart() {
    if (!this.thisMonthCumulative.length) return;

    const days = this.thisMonthCumulative.length;
    const labels = Array.from({ length: days }, (_, i) => i + 1);

    if (this.lineChart) {
      this.lineChart.destroy();
    }

    this.lineChart = new Chart('spendingLineChart', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'This Month',
            data: this.thisMonthCumulative,
            borderColor: '#1e88e5',
            backgroundColor: 'rgba(30,136,229,0.1)',
            tension: 0.4,
            fill: true
          },
          {
            label: 'Last Month',
            data: this.lastMonthCumulative,
            borderColor: '#90caf9',
            borderDash: [6, 4],
            tension: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `₹ ${ctx.raw}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false }
          },
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }

}
