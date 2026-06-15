import { Component, OnDestroy, ChangeDetectorRef, HostListener, Injector, inject, runInInjectionContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IncomeService } from '../../services/income.service';
import { ExpenseService } from '../../services/expense.service';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Chart, registerables } from 'chart.js';
import { MatDialog } from '@angular/material/dialog';
import { AddExpenseComponent } from '../../dialogs/add-expense/add-expense.component';
import { AddIncomeComponent } from '../../dialogs/add-income/add-income.component';
import { UpcomingPaymentService } from '../../services/upcoming-payment.service';
import { combineLatest, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ReceivableService } from '../../services/receivable.service';
import { CarryForwardService } from '../../services/carry-forward.service';
import { StateManagementService } from '../../services/state-management.service';
import { PinLockService } from '../../services/pin-lock.service';
Chart.register(...registerables);


const hoverGuideLinePlugin = {
  id: 'hoverGuideLine',
  afterDraw(chart: any) {
    const active = chart.tooltip?.getActiveElements?.();
    if (!active || !active.length) return;
    const { ctx, chartArea: { top, bottom } } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#94a3b8';
    ctx.stroke();
    ctx.restore();
  }
};


@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatProgressBarModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnDestroy {
  private destroy$ = new Subject<void>();
  private cdr = inject(ChangeDetectorRef);
  private injector = inject(Injector);

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
  allIncome: any[] = [];

  // Global — not filtered by month
  upcomingPayments: any[] = [];
  receivables: any[] = [];
  totalReceivable = 0;

  cumulativeTotals: number[] = [];

  fabOpen = false;

  gaugeChart!: Chart;
  gaugeCategory = '';
  gaugeSpent = 0;
  gaugeLimit = 50000;

  recentExpenses: any[] = [];
  allExpenses: any[] = [];

  lineChart!: Chart;

  thisMonthCumulative: number[] = [];
  lastMonthCumulative: number[] = [];

  categorySummary: {
    name: string;
    amount: number;
    percentage: number;
    icon: string;
  }[] = [];

  expenses: any[] = [];
  isLoading = false;

  showAllExpensesModal = false;
  showAllIncomeModal = false;

  newReceivable = {
    title: '',
    amount: 0,
    trackInExpenses: true
  };

  months: { label: string; value: string }[] = [];
  selectedMonth!: string;

  constructor(
    private incomeService: IncomeService,
    private expenseService: ExpenseService,
    private upcomingService: UpcomingPaymentService,
    private receivableService: ReceivableService,
    private stateManagement: StateManagementService,
    private carryForwardService: CarryForwardService,
    private dialog: MatDialog,
    private pinLockService: PinLockService
  ) {}

  async ngOnInit() {
    this.generateMonths();
    this.selectedMonth = this.getCurrentMonth();
    const monthKey = this.getSelectedMonthKey();

    this.stateManagement.initializeState(monthKey);
    this.setupGlobalSubscriptions();
    this.setupMonthlySubscriptions();

    await this.loadMonthData(monthKey);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadMonthData(monthKey: string): Promise<void> {
    await this.carryForwardService.checkAndProcessCarryForward(monthKey);
    this.stateManagement.setCurrentMonth(monthKey);
    this.calculateMonthStats();
    this.cdr.markForCheck();
  }

  // ── Global subscriptions — set up ONCE, never re-trigger on month change ──

  private setupGlobalSubscriptions() {

    // Receivables: show all regardless of month
    this.receivableService.getAll().pipe(
      takeUntil(this.destroy$)
    ).subscribe(data => {
      const sorted = [...data].sort((a: any, b: any) => {
        const da = a['createdAt']?.seconds ? new Date(a['createdAt'].seconds * 1000).getTime() : 0;
        const db = b['createdAt']?.seconds ? new Date(b['createdAt'].seconds * 1000).getTime() : 0;
        return db - da;
      });
      this.receivables = sorted;
      this.totalReceivable = sorted.reduce(
        (sum: number, r: any) => r.status === 'PENDING' ? sum + r.amount : sum,
        0
      );
      this.cdr.markForCheck();
    });

    // Upcoming payments: show all regardless of month
    this.upcomingService.getAll().pipe(
      takeUntil(this.destroy$)
    ).subscribe(data => {
      this.upcomingPayments = data
        .map((p: any) => ({
          ...p,
          dueIn: this.calculateDueInDays(p['dueDate'])
        }))
        .filter((p: any) => p.dueIn >= 0)
        .sort((a: any, b: any) => a.dueIn - b.dueIn);
      this.cdr.markForCheck();
    });
  }

  // ── Monthly subscriptions — re-trigger when month changes ──────

  private setupMonthlySubscriptions() {
    this.stateManagement.loading$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(loading => {
      this.isLoading = loading;
      this.cdr.markForCheck();
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
      this.cdr.markForCheck();

      const lastMonthKey = this.getLastMonthKey();
      runInInjectionContext(this.injector, () =>
        this.expenseService.getExpensesByMonth(lastMonthKey)
      ).pipe(
        takeUntil(this.destroy$)
      ).subscribe((lastMonthExpenses: any[]) => {
        const activeLastMonth = lastMonthExpenses.filter((e: any) => e.status !== 'PAID');
        this.lastMonthCumulative = this.prepareCumulativeData(activeLastMonth, lastMonthKey);
        this.renderLineChart();
        this.cdr.markForCheck();
      });
    });
  }

  async addReceivable() {
    if (!this.newReceivable.title || this.newReceivable.amount <= 0) return;

    await this.stateManagement.addReceivable({
      title: this.newReceivable.title,
      amount: this.newReceivable.amount,
      monthKey: this.getSelectedMonthKey(),   // used only for the optional Lent expense
      trackInExpenses: this.newReceivable.trackInExpenses
    });

    this.newReceivable = { title: '', amount: 0, trackInExpenses: true };
    this.cdr.markForCheck();
  }

  async markReceivableReceived(item: any) {
    if (item.status === 'PAID') {
      alert('This receivable has already been marked as paid.');
      return;
    }
    // Income will be booked to the currently selected month
    await this.stateManagement.markReceivableAsPaid(item, this.getSelectedMonthKey(), this.expenses);
    this.cdr.markForCheck();
  }

  async deleteReceivable(id: string) {
    const receivable = this.receivables.find(r => r.id === id);
    if (receivable?.status === 'PAID') {
      alert('Cannot delete a receivable that has been marked as paid.');
      return;
    }
    if (confirm('Delete this receivable?')) {
      await this.stateManagement.deleteReceivable(id, this.receivables, this.expenses);
      this.cdr.markForCheck();
    }
  }

  markAsPaid(payment: any) {
    // Expense booked to the currently selected month
    this.expenseService.addExpense({
      description: payment.description,
      amount: payment.amount,
      category: payment.category,
      date: new Date(),
      month: this.getSelectedMonthKey()
    });

    this.upcomingService.delete(payment.id);
    this.cdr.markForCheck();
  }

  deleteUpcoming(id: string) {
    if (confirm('Delete this upcoming payment?')) {
      this.upcomingService.delete(id);
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:contextmenu', ['$event'])
  onRightClick(event: MouseEvent) {
    event.preventDefault();
    if (confirm('Lock dashboard?')) {
      this.pinLockService.lock();
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
    } else if (new Date(year, month - 1) < new Date(today.getFullYear(), today.getMonth())) {
      this.completionPercent = 100;
      this.remainingDays = 0;
    } else {
      this.completionPercent = 0;
      this.remainingDays = totalDays;
    }
  }

  async onMonthChange() {
    const monthKey = this.getSelectedMonthKey();
    await this.loadMonthData(monthKey);
  }

  getSelectedMonthKey(): string {
    const monthIndex = this.months.findIndex(m => m.value === this.selectedMonth);
    return monthIndex !== -1 ? this.months[monthIndex].value : this.selectedMonth;
  }

  prepareDailyExpenses(expenses: any[]) {
    const [year, month] = this.selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    this.dailyTotals = new Array(daysInMonth).fill(0);

    expenses.forEach(exp => {
      const day = new Date(exp.date.seconds * 1000).getDate();
      this.dailyTotals[day - 1] += exp.amount;
    });

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

    const barGradient = ctx.createLinearGradient(0, 0, 0, 260);
    barGradient.addColorStop(0, 'rgba(37, 99, 235, 0.95)');
    barGradient.addColorStop(0.55, 'rgba(59, 130, 246, 0.72)');
    barGradient.addColorStop(1, 'rgba(125, 211, 252, 0.34)');

    const lineGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    lineGradient.addColorStop(0, '#06b6d4');
    lineGradient.addColorStop(1, '#0ea5e9');

    const barColors = this.dailyTotals.map((_, index) =>
      index + 1 === todayDate ? '#1d4ed8' : barGradient
    );

    if (this.barChart) this.barChart.destroy();

    this.barChart = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Daily Spending',
            data: this.dailyTotals,
            backgroundColor: barColors,
            borderColor: 'rgba(255,255,255,0.55)',
            borderWidth: 1,
            borderRadius: 10,
            maxBarThickness: 18
          },
          {
            type: 'line',
            label: 'Cumulative',
            data: this.cumulativeTotals,
            borderColor: lineGradient,
            borderWidth: 2.5,
            tension: 0.34,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: '#0284c7',
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#e2e8f0',
            bodyColor: '#f8fafc',
            cornerRadius: 10,
            padding: 10,
            callbacks: {
              label: item => item.dataset.type === 'line'
                ? `Total: ₹${item.raw}`
                : `Spent: ₹${item.raw}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(148, 163, 184, 0.26)', drawOnChartArea: true, drawTicks: false },
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: (value: string | number) => `₹${value}`
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
    switch (category?.toLowerCase()) {
      case 'food': return '🍔';
      case 'shopping': return '🛍️';
      case 'transport': return '🚕';
      case 'bills': return '💡';
      case 'lent': return '🤝';
      case 'petrol': return '⛽';
      case 'tickets': return '🎟️';
      default: return '📦';
    }
  }

  prepareCategoryGauge() {
    if (!this.categorySummary.length) return;
    const topCategory = this.categorySummary[0];
    this.gaugeCategory = topCategory.name;
    this.gaugeSpent = topCategory.amount;
    this.renderGaugeChart();
  }

  renderGaugeChart() {
    const gaugeCanvas = document.getElementById('categoryGauge') as HTMLCanvasElement | null;
    if (!gaugeCanvas) return;

    const used = this.gaugeSpent;
    const remaining = Math.max(this.gaugeLimit - used, 0);

    if (this.gaugeChart) this.gaugeChart.destroy();

    this.gaugeChart = new Chart(gaugeCanvas, {
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
          tooltip: { callbacks: { label: ctx => `₹ ${ctx.raw}` } }
        }
      }
    });
  }

  prepareRecentExpenses(expenses: any[]) {
    const sorted = [...expenses].sort((a, b) => {
      const da = new Date(a.date.seconds * 1000).getTime();
      const db = new Date(b.date.seconds * 1000).getTime();
      return db - da;
    });
    this.allExpenses = sorted;
    this.recentExpenses = sorted.slice(0, 5);
  }

  getLastMonthKey(): string {
    const [year, month] = this.selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 2);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  prepareCumulativeData(expenses: any[], monthKey: string): number[] {
    const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
    const year = Number.isFinite(yearRaw) ? yearRaw : this.today.getFullYear();
    const month = Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12
      ? monthRaw
      : this.today.getMonth() + 1;

    const daysInMonth = new Date(year, month, 0).getDate();
    if (!Number.isFinite(daysInMonth) || daysInMonth <= 0) return [];

    const dailyTotals = new Array(daysInMonth).fill(0);
    expenses.forEach(exp => {
      const day = new Date(exp.date.seconds * 1000).getDate();
      if (day >= 1 && day <= daysInMonth) {
        dailyTotals[day - 1] += exp.amount;
      }
    });

    for (let i = 1; i < dailyTotals.length; i++) {
      dailyTotals[i] += dailyTotals[i - 1];
    }
    return dailyTotals;
  }

  renderLineChart() {
    if (!this.thisMonthCumulative.length) return;

    const days = this.thisMonthCumulative.length;
    const labels = Array.from({ length: days }, (_, i) => `Day ${i + 1}`);

    const normalizeSeries = (series: number[], targetLength: number): number[] => {
      if (!series.length) return new Array(targetLength).fill(0);
      if (series.length >= targetLength) return series.slice(0, targetLength);
      const lastValue = series[series.length - 1];
      return [...series, ...new Array(targetLength - series.length).fill(lastValue)];
    };

    const thisMonthSeries = normalizeSeries(this.thisMonthCumulative, days);
    const lastMonthSeries = normalizeSeries(this.lastMonthCumulative, days);

    const canvas = document.getElementById('spendingLineChart') as HTMLCanvasElement | null;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const gradient = context.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.18)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.02)');

    if (this.lineChart) this.lineChart.destroy();

    this.lineChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Current Month',
            data: thisMonthSeries,
            borderColor: '#2563eb',
            backgroundColor: gradient,
            borderWidth: 3,
            tension: 0.32,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: '#2563eb',
            pointBorderWidth: 0
          },
          {
            label: 'Previous Month',
            data: lastMonthSeries,
            borderColor: '#94a3b8',
            borderWidth: 2,
            tension: 0.32,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: '#94a3b8',
            pointBorderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#0f172a',
            bodyColor: '#334155',
            borderColor: '#cbd5e1',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              title: items => items.length ? items[0].label : '',
              label: context => `${context.dataset.label}: ₹${context.raw}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(203, 213, 225, 0.24)' },
            ticks: {
              color: '#64748b',
              maxTicksLimit: 6,
              callback: (_value, index) => `${index + 1}`,
              font: { size: 11 }
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(148, 163, 184, 0.22)', drawOnChartArea: true, drawTicks: false },
            ticks: {
              color: '#64748b',
              maxTicksLimit: 6,
              callback: (value: string | number) => `₹${value}`,
              font: { size: 11 }
            }
          }
        }
      },
      plugins: [hoverGuideLinePlugin]
    });
  }

  get lastMonthExpense(): number {
    return this.lastMonthCumulative.at(-1) || 0;
  }

  get spendingDelta(): number {
    return this.totalExpenses - this.lastMonthExpense;
  }

  get spendingDeltaPercent(): number {
    if (this.lastMonthExpense === 0) {
      return this.totalExpenses > 0 ? 100 : 0;
    }
    return Math.abs((this.spendingDelta / this.lastMonthExpense) * 100);
  }

  openAddExpense() {
    this.fabOpen = false;
    this.cdr.markForCheck();
    this.dialog.open(AddExpenseComponent, {
      width: 'min(92vw, 520px)',
      maxWidth: '95vw',
      data: { month: this.getSelectedMonthKey() }
    });
  }

  editExpense(expense: any) {
    this.dialog.open(AddExpenseComponent, {
      width: 'min(92vw, 520px)',
      maxWidth: '95vw',
      data: { expense, month: this.getSelectedMonthKey() }
    });
  }

  editExpenseFromModal(expense: any) {
    this.closeAllExpensesModal();
    setTimeout(() => this.editExpense(expense), 150);
  }

  deleteExpense(id: string) {
    if (confirm('Delete this expense?')) {
      this.expenseService.deleteExpense(id);
      this.cdr.markForCheck();
    }
  }

  toggleFab() {
    this.fabOpen = !this.fabOpen;
    this.cdr.markForCheck();
  }

  openAddIncome() {
    this.fabOpen = false;
    this.cdr.markForCheck();
    this.dialog.open(AddIncomeComponent, {
      width: 'min(92vw, 520px)',
      maxWidth: '95vw',
      data: { month: this.getSelectedMonthKey() }
    });
  }

  prepareRecentIncome(income: any[]) {
    const sorted = [...income].sort((a, b) => {
      const da = new Date(a.date.seconds * 1000).getTime();
      const db = new Date(b.date.seconds * 1000).getTime();
      return db - da;
    });
    this.allIncome = sorted;
    this.recentIncome = sorted.slice(0, 3);
  }

  editIncome(income: any) {
    if (income.isSystemGenerated) {
      alert('System-generated transactions cannot be edited.');
      return;
    }
    this.dialog.open(AddIncomeComponent, {
      width: 'min(92vw, 520px)',
      maxWidth: '95vw',
      data: { income, month: this.getSelectedMonthKey() }
    });
  }

  editIncomeFromModal(income: any) {
    this.closeAllIncomeModal();
    setTimeout(() => this.editIncome(income), 150);
  }

  deleteIncome(id: string) {
    const income = this.allIncome.find(i => i.id === id);
    if (income?.isSystemGenerated) {
      alert('System-generated transactions cannot be deleted.');
      return;
    }
    if (confirm('Delete this income?')) {
      this.incomeService.deleteIncome(id);
      this.cdr.markForCheck();
    }
  }

  openAllExpensesModal() {
    this.showAllExpensesModal = true;
    document.body.style.overflow = 'hidden';
    this.cdr.markForCheck();
  }

  closeAllExpensesModal() {
    this.showAllExpensesModal = false;
    document.body.style.overflow = '';
    this.cdr.markForCheck();
  }

  openAllIncomeModal() {
    this.showAllIncomeModal = true;
    document.body.style.overflow = 'hidden';
    this.cdr.markForCheck();
  }

  closeAllIncomeModal() {
    this.showAllIncomeModal = false;
    document.body.style.overflow = '';
    this.cdr.markForCheck();
  }
}