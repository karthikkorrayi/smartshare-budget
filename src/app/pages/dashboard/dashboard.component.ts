import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IncomeService } from '../../services/income.service';
import { ExpenseService } from '../../services/expense.service';
import { getCurrentMonth } from '../../utils/date.util';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Chart, registerables } from 'chart.js';
import { MatDialog } from '@angular/material/dialog';
import { AddExpenseComponent } from '../../dialogs/add-expense/add-expense.component';
import { AddIncomeComponent } from '../../dialogs/add-income/add-income.component';
import { UpcomingPaymentService } from '../../services/upcoming-payment.service';
import { combineLatest, Subject } from 'rxjs';
import { takeUntil, switchMap, map } from 'rxjs/operators';
import { ReceivableService } from '../../services/receivable.service';
import { CarryForwardService } from '../../services/carry-forward.service';
import { StateManagementService } from '../../services/state-management.service';
Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatProgressBarModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnDestroy {
  private destroy$ = new Subject<void>();

  username = 'Karthik';
  today = new Date();

  completionPercent = 0;
  remainingDays = 0;

  totalIncome = 0;
  totalExpenses = 0;
  availableBalance = 0;

  barChart!: Chart;
  dailyTotals: number[] = [];

  recentIncome: any[] = [];

  upcomingPayments: any[] = [];

  cumulativeTotals: number[] = [];

  fabOpen = false;

  gaugeChart!: Chart;
  gaugeCategory = '';
  gaugeSpent = 0;
  gaugeLimit = 50000;

  recentExpenses: any[] = [];

  lineChart!: Chart;

  thisMonthCumulative: number[] = [];
  lastMonthCumulative: number[] = [];

  categorySummary: {
    name: string;
    amount: number;
    percentage: number;
    icon: string;
  }[] = [];

  receivables: any[] = [];
  totalReceivable = 0;
  expenses: any[] = [];

  newReceivable = {
    title: '',
    amount: 0
  };

  constructor(
    private incomeService: IncomeService,
    private expenseService: ExpenseService,
    private upcomingService: UpcomingPaymentService,
    private stateManagement: StateManagementService,
    private carryForwardService: CarryForwardService,
    private dialog: MatDialog
  ) {}

  months: { label: string; value: string }[] = [];
  selectedMonth!: string;

  async ngOnInit() {
    this.generateMonths();
    this.selectedMonth = this.getCurrentMonth();

    await this.carryForwardService.checkAndProcessCarryForward(this.selectedMonth);

    const monthKey = this.getSelectedMonthKey();
    this.stateManagement.initializeState(monthKey);

    this.calculateMonthStats();
    this.setupReactiveSubscriptions();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupReactiveSubscriptions() {
    this.stateManagement.currentMonth$.pipe(
      takeUntil(this.destroy$),
      switchMap(month => this.upcomingService.getByMonth(month))
    ).subscribe(data => {
      this.upcomingPayments = data.map(p => ({
        ...p,
        dueIn: this.calculateDueInDays(p['dueDate'])
      })).filter(p => p.dueIn >= 0)
        .sort((a, b) => a.dueIn - b.dueIn);
    });

    this.stateManagement.receivables$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(data => {
      this.receivables = data;
      this.totalReceivable = data.reduce(
        (sum: number, r: any) => sum + r.amount,
        0
      );
    });

    combineLatest([
      this.stateManagement.incomes$,
      this.stateManagement.expenses$,
      this.stateManagement.currentMonth$
    ]).pipe(
      takeUntil(this.destroy$)
    ).subscribe(([incomes, expenses, currentMonth]) => {
      this.expenses = expenses;
      const activeExpenses = expenses.filter((e: any) => e.status !== 'PAID');

      this.totalIncome = incomes.reduce((sum: number, i: any) => sum + i.amount, 0);
      this.totalExpenses = activeExpenses.reduce((sum: number, e: any) => sum + e.amount, 0);
      this.availableBalance = this.totalIncome - this.totalExpenses;

      this.prepareRecentIncome(incomes);
      this.prepareDailyExpenses(activeExpenses);
      this.prepareCategorySummary(activeExpenses);
      this.prepareRecentExpenses(expenses);

      this.thisMonthCumulative = this.prepareCumulativeData(activeExpenses, currentMonth);

      const lastMonthKey = this.getLastMonthKey();
      this.expenseService.getExpensesByMonth(lastMonthKey).pipe(
        takeUntil(this.destroy$)
      ).subscribe((lastMonthExpenses: any[]) => {
        const activeLastMonth = lastMonthExpenses.filter((e: any) => e.status !== 'PAID');
        this.lastMonthCumulative = this.prepareCumulativeData(activeLastMonth, lastMonthKey);
        this.renderLineChart();
      });
    });
  }

  async addReceivable() {
    if (!this.newReceivable.title || this.newReceivable.amount <= 0) return;

    await this.stateManagement.addReceivable({
      title: this.newReceivable.title,
      amount: this.newReceivable.amount,
      monthKey: this.getSelectedMonthKey()
    });

    this.newReceivable = { title: '', amount: 0 };
  }

  async markReceivableReceived(item: any) {
    if (item.status === 'PAID') {
      alert('This receivable has already been marked as paid.');
      return;
    }
    await this.stateManagement.markReceivableAsPaid(item, this.getSelectedMonthKey(), this.expenses);
  }

  async deleteReceivable(id: string) {
    const receivable = this.receivables.find(r => r.id === id);
    if (receivable?.status === 'PAID') {
      alert('Cannot delete a receivable that has been marked as paid.');
      return;
    }
    if (confirm('Delete this receivable?')) {
      await this.stateManagement.deleteReceivable(id, this.receivables, this.expenses);
    }
  }

  calculateDueInDays(dueDate: any): number {
    const due = new Date(dueDate.seconds * 1000);
    const today = new Date();
    return Math.ceil((due.getTime() - today.getTime()) / 86400000);
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

  async onMonthChange() {
    const monthKey = this.getSelectedMonthKey();

    await this.carryForwardService.checkAndProcessCarryForward(monthKey);

    this.stateManagement.setCurrentMonth(monthKey);
    this.calculateMonthStats();
  }

  getSelectedMonthKey(): string {
    const monthIndex = this.months.findIndex(m => m.value === this.selectedMonth);
    return monthIndex !== -1 ? this.months[monthIndex].value : this.selectedMonth;
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

    // 🔥 cumulative calculation
    this.cumulativeTotals = [...this.dailyTotals];
    for (let i = 1; i < this.cumulativeTotals.length; i++) {
      this.cumulativeTotals[i] += this.cumulativeTotals[i - 1];
    }

    this.renderBarChart(daysInMonth);
  }

 renderBarChart(daysInMonth: number) {
  const labels = Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString());
  const todayDate = this.today.getDate();

  const canvas = document.getElementById('monthlyBarChart') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  // Gradient for bars
  const barGradient = ctx.createLinearGradient(0, 0, 0, 240);
  barGradient.addColorStop(0, 'rgba(59, 130, 246, 0.9)');
  barGradient.addColorStop(1, 'rgba(59, 130, 246, 0.2)');

  const barColors = this.dailyTotals.map((_, index) =>
    index + 1 === todayDate ? '#2563eb' : barGradient
  );

  if (this.barChart) {
    this.barChart.destroy();
  }

  this.barChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        // BAR DATASET – Daily spending
        {
          type: 'bar',
          data: this.dailyTotals,
          backgroundColor: barColors,
          borderRadius: 12,
          maxBarThickness: 18
        },

        // LINE DATASET – Cumulative total
        {
          type: 'line',
          data: this.cumulativeTotals,
          borderColor: '#68d2ffff',
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#68d2ffff',
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#111827',
          titleColor: '#fff',
          bodyColor: '#fff',
          cornerRadius: 8,
          padding: 10,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.type === 'line') {
                return `Total: ₹${ctx.raw}`;
              }
              return `Spent: ₹${ctx.raw}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#9ca3af',
            font: { size: 11 }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(21, 173, 255, 0.3)',
            drawOnChartArea: true,
            drawTicks: false
          },
          ticks: {
            color: '#9ca3af',
            font: { size: 11 },
            callback: value => `₹${value}`
          }
        }
      }
    }
  });
}

  get selectedMonthLabel(): string {
    const found = this.months.find(m => m.value === this.selectedMonth);
    return found ? found.label : '';
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
      percentage: Math.round((categoryMap[cat] / maxAmount) * 100),
      icon: this.getCategoryIcon(cat)
    }));
    this.categorySummary.sort((a, b) => b.amount - a.amount);
    this.prepareCategoryGauge();
  }
  
  getCategoryIcon(category: string): string {
    switch (category.toLowerCase()) {
      case 'food': return '🍔';
      case 'shopping': return '🛍️';
      case 'transport': return '🚕';
      case 'bills': return '💡';
      case 'lent': return '🤝';
      default: return '📦';
    }
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

    const ctx = document
      .getElementById('spendingLineChart') as HTMLCanvasElement;

    const gradient = ctx.getContext('2d')!.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(30,136,229,0.25)');
    gradient.addColorStop(1, 'rgba(30,136,229,0.02)');

    if (this.lineChart) {
      this.lineChart.destroy();
    }

    this.lineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'This Month',
            data: this.thisMonthCumulative,
            borderColor: '#1e88e5',
            backgroundColor: gradient,
            borderWidth: 3,
            tension: 0.45,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5
          },
          {
            label: 'Last Month',
            data: this.lastMonthCumulative,
            borderColor: '#9ecbff',
            borderWidth: 2,
            tension: 0.45,
            borderDash: [6, 6],
            fill: false,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#333',
            bodyColor: '#555',
            borderColor: '#e0e0e0',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: ctx => `₹ ${ctx.raw}`
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: '#888',
              font: { size: 11 }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(0,0,0,0.04)',
              drawOnChartArea: true,
              drawTicks: false
            },
            ticks: {
              color: '#888',
              font: { size: 11 }
            }
          }
        }
      }
    });
  }

  openAddExpense() {
    this.dialog.open(AddExpenseComponent, {
      width: '320px',
      data: {
        month: this.getSelectedMonthKey()
      }
    });
  }

  editExpense(expense: any) {
    this.dialog.open(AddExpenseComponent, {
      width: '320px',
      data: {
        expense,
        month: this.getSelectedMonthKey()
      }
    });
  }

  deleteExpense(id: string) {
    if (confirm('Delete this expense?')) {
      this.expenseService.deleteExpense(id);
    }
  }

  toggleFab() {
    this.fabOpen = !this.fabOpen;
  }

  openAddIncome() {
    this.fabOpen = false;
    this.dialog.open(AddIncomeComponent, {
      width: '320px',
      data: {
        month: this.getSelectedMonthKey()
      }
    });
  }

  prepareRecentIncome(income: any[]) {
    this.recentIncome = [...income]
      .sort((a, b) => {
        const da = new Date(a.date.seconds * 1000).getTime();
        const db = new Date(b.date.seconds * 1000).getTime();
        return db - da;
      })
      .slice(0, 3);
  }

  editIncome(income: any) {
    if (income.isSystemGenerated) {
      alert('System-generated transactions cannot be edited.');
      return;
    }

    this.dialog.open(AddIncomeComponent, {
      width: '320px',
      data: {
        income,
        month: this.getSelectedMonthKey()
      }
    });
  }

  deleteIncome(id: string) {
    const income = this.recentIncome.find(i => i.id === id);
    if (income?.isSystemGenerated) {
      alert('System-generated transactions cannot be deleted.');
      return;
    }

    if (confirm('Delete this income?')) {
      this.incomeService.deleteIncome(id);
    }
  }

  markAsPaid(payment: any) {
    // Add to expenses
    this.expenseService.addExpense({
      description: payment.description,
      amount: payment.amount,
      category: payment.category,
      date: new Date(),
      month: this.getSelectedMonthKey()
    });

    // Remove from upcoming list
    this.upcomingService.delete(payment.id);
  }

  deleteUpcoming(id: string) {
    if (confirm('Delete this upcoming payment?')) {
      this.upcomingService.delete(id);
    }
  }

}