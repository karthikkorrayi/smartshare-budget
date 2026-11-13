import { Component, OnDestroy, ChangeDetectorRef, Injector, inject, runInInjectionContext } from '@angular/core';
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
import { filter, switchMap, takeUntil } from 'rxjs/operators';
import { ReceivableService } from '../../services/receivable.service';
import { CarryForwardService } from '../../services/carry-forward.service';
import { StateManagementService } from '../../services/state-management.service';
import { AuthService } from '../../services/auth.service';
import { DailyPulseComponent } from '../../components/daily-pulse/daily-pulse.component';
import { toDate } from '../../utils/firestore.util';
import { CardTransactionsService } from '../../services/card-transactions.service';
import { UndoService } from '../../services/undo.service';
import { VisiblePipe } from '../../pipes/visible.pipe';
import { BudgetHeroComponent } from '../../components/budget-hero/budget-hero.component';
import { BudgetSummary, MoneyItem, dailySpend, spendValue, summarizeMonth, walletMoneyItem } from '../../utils/budget.util';
import { WalletsService } from '../../services/wallets.service';
import { daysBetween, monthKey as monthKeyOf } from '../../utils/date-input.util';

/** Firestore Timestamp/Date → epoch ms; 0 for missing dates (one bad record can't break Overview). */
const ms = (v: unknown): number => toDate(v)?.getTime() ?? 0;
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
  imports: [DailyPulseComponent, BudgetHeroComponent, VisiblePipe, CommonModule, FormsModule, MatCardModule, MatProgressBarModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnDestroy {
  private destroy$ = new Subject<void>();
  private cdr = inject(ChangeDetectorRef);
  private injector = inject(Injector);

  private auth = inject(AuthService);

  /** First name from the signed-in account (was hardcoded). */
  get username(): string {
    const u = this.auth.user();
    return u?.displayName?.trim().split(/\s+/)[0] || u?.email?.split('@')[0] || 'there';
  }
  today = new Date();

  /** Budget-first summary shown at the top of Overview (expenses + card spends vs income). */
  summary: BudgetSummary | null = null;
  private undo = inject(UndoService);
  private cardTxns = inject(CardTransactionsService);
  private walletsService = inject(WalletsService);

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
    private dialog: MatDialog
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
    this.stateManagement.setCurrentMonth(monthKey);
    this.cdr.markForCheck();
    // Runs after the month is shown; only acts on the current month.
    this.carryForwardService.checkAndProcessCarryForward(monthKey).catch(err => console.warn('[Overview] carry-forward', err));
  }

  // ── Global subscriptions — set up ONCE, never re-trigger on month change ──

  private setupGlobalSubscriptions() {

    // Receivables: show all regardless of month
    this.receivableService.getAll().pipe(
      takeUntil(this.destroy$)
    ).subscribe(data => {
      const sorted = [...data].sort((a: any, b: any) => {
        return ms(b['createdAt']) - ms(a['createdAt']);
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
      // Overdue payments used to be filtered out (dueIn < 0) and silently vanished. Now they stay, on top.
      this.upcomingPayments = data
        .map((p: any) => ({
          ...p,
          dueIn: this.calculateDueInDays(p['dueDate'])
        }))
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

    const month$ = this.stateManagement.currentMonth$.pipe(filter(m => !!m));
    const cards$ = month$.pipe(switchMap(m => this.cardTxns.byMonth$(m)));
    // Last month (for "vs last month" and the trend line). One listener at a time via switchMap —
    // the old code opened a new listener on every data change and never closed them.
    const lastExpenses$ = month$.pipe(switchMap(m => runInInjectionContext(this.injector, () => this.expenseService.getExpensesByMonth(this.prevMonth(m)))));
    const lastCards$ = month$.pipe(switchMap(m => this.cardTxns.byMonth$(this.prevMonth(m))));
    const wallet$ = month$.pipe(switchMap(m => this.walletsService.byMonth$(m)));
    const lastWallet$ = month$.pipe(switchMap(m => this.walletsService.byMonth$(this.prevMonth(m))));

    combineLatest([
      this.stateManagement.incomes$,
      this.stateManagement.expenses$,
      this.stateManagement.currentMonth$,
      cards$,
      lastExpenses$,
      lastCards$,
      wallet$,
      lastWallet$,
    ]).pipe(
      takeUntil(this.destroy$)
    ).subscribe(([incomes, expenses, currentMonth, cards, lastExpenses, lastCards, wallet, lastWallet]) => {
      this.expenses = expenses;
      const items = [...expenses.map(e => this.expenseItem(e)), ...cards.map(c => this.cardItem(c)), ...wallet.map(t => walletMoneyItem(t))];
      const lastItems = [
        ...lastExpenses.map((e: any) => this.expenseItem(e)),
        ...lastCards.map(c => this.cardItem(c)),
        ...lastWallet.map(t => walletMoneyItem(t)),
      ];

      this.totalIncome = incomes.reduce((sum: number, i: any) => sum + (Number(i.amount) || 0), 0);
      this.summary = summarizeMonth(currentMonth, this.totalIncome, items, lastItems);
      this.totalExpenses = this.summary.spent;
      this.availableBalance = this.summary.balance;

      this.prepareRecentIncome(incomes);
      this.prepareDailyExpenses(items);
      this.prepareCategorySummary(items);
      this.prepareRecentExpenses(expenses);

      const [y, m] = currentMonth.split('-').map(Number);
      this.thisMonthCumulative = this.cumulative(dailySpend(items, y, m - 1));
      const [ly, lm] = this.prevMonth(currentMonth).split('-').map(Number);
      this.lastMonthCumulative = this.cumulative(dailySpend(lastItems, ly, lm - 1));
      this.renderLineChart();
      this.cdr.markForCheck();
    });
  }

  private expenseItem(e: any): MoneyItem {
    return { source: 'expense', amount: Number(e.amount) || 0, date: toDate(e.date), category: e.category, status: e.status };
  }

  private cardItem(c: any): MoneyItem {
    return { source: 'card', amount: Number(c.amount) || 0, date: toDate(c.txnDate), category: c.category, direction: c.direction };
  }

  private prevMonth(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return monthKeyOf(new Date(y, m - 2, 1));
  }

  private cumulative(daily: number[]): number[] {
    const out = [...daily];
    for (let i = 1; i < out.length; i++) out[i] = Math.round((out[i] + out[i - 1]) * 100) / 100;
    return out;
  }

  async addReceivable() {
    if (!this.newReceivable.title || this.newReceivable.amount <= 0) return;

    const created = await this.stateManagement.addReceivable({
      title: this.newReceivable.title,
      amount: this.newReceivable.amount,
      trackInExpenses: this.newReceivable.trackInExpenses
    });
    this.undo.offer(`Added "${this.newReceivable.title}" to receivables`, () => this.stateManagement.removeReceivableCompletely(created));

    this.newReceivable = { title: '', amount: 0, trackInExpenses: true };
    this.cdr.markForCheck();
  }

  /** Marked as received after 5 s (Undo cancels it). Tracked loans add today's income. */
  markReceivableReceived(item: any, event?: Event) {
    if (item.status === 'PAID') return;
    const box = event?.target as HTMLInputElement | undefined;
    this.undo.defer(
      `Marked "${item.title}" as received${item.trackInExpenses ? ` · ₹${item.amount} added to income` : ''}`,
      [],
      () => this.stateManagement.markReceivableAsPaid(item),
      () => { if (box) box.checked = false; }
    );
  }

  deleteReceivable(id: string) {
    const receivable = this.receivables.find(r => r.id === id);
    if (!receivable || receivable.status === 'PAID') return;
    this.undo.defer(
      `Deleted receivable "${receivable.title}"`,
      [id, ...(receivable.lentExpenseId ? [receivable.lentExpenseId] : [])],
      () => this.stateManagement.deleteReceivable(id, this.receivables, this.expenses)
    );
  }

  /** Pays an upcoming item: after 5 s it's booked as today's expense and removed (Undo cancels). */
  markAsPaid(payment: any, event?: Event) {
    const box = event?.target as HTMLInputElement | undefined;
    this.undo.defer(
      `Paid "${payment.description}" · ₹${payment.amount} added to today's expenses`,
      [payment.id],
      async () => {
        const today = new Date();
        await this.expenseService.addExpense({
          description: payment.description,
          amount: payment.amount,
          category: payment.category || 'Bills',
          date: today,
          month: monthKeyOf(today)
        });
        await this.upcomingService.delete(payment.id);
      },
      () => { if (box) box.checked = false; }
    );
  }

  deleteUpcoming(id: string) {
    const p = this.upcomingPayments.find(x => x.id === id);
    this.undo.defer(`Deleted "${p?.description ?? 'payment'}"`, [id], () => this.upcomingService.delete(id));
  }

  /** Whole calendar days until the due date (0 = today, negative = overdue). */
  calculateDueInDays(dueDate: any): number {
    const due = toDate(dueDate);
    return due ? daysBetween(new Date(), due) : 0;
  }

  dueLabel(days: number): string {
    if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `Due in ${days} days`;
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

  async onMonthChange() {
    const monthKey = this.getSelectedMonthKey();
    await this.loadMonthData(monthKey);
  }

  getSelectedMonthKey(): string {
    const monthIndex = this.months.findIndex(m => m.value === this.selectedMonth);
    return monthIndex !== -1 ? this.months[monthIndex].value : this.selectedMonth;
  }

  /** Daily bars + running total — expenses and card spends together. */
  prepareDailyExpenses(items: MoneyItem[]) {
    const [year, month] = this.selectedMonth.split('-').map(Number);
    this.dailyTotals = dailySpend(items, year, month - 1);
    this.cumulativeTotals = this.cumulative(this.dailyTotals);
    this.renderBarChart(this.dailyTotals.length);
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

  /** Spending by category (expenses + card purchases); % = share of this month's spending. */
  prepareCategorySummary(items: MoneyItem[]) {
    const byCat: Record<string, number> = {};
    for (const it of items) {
      const v = spendValue(it);
      if (v <= 0) continue; // refunds reduce the total, not a category
      const cat = it.category || 'Others';
      byCat[cat] = (byCat[cat] || 0) + v;
    }
    const total = Object.values(byCat).reduce((a, b) => a + b, 0);
    this.categorySummary = Object.keys(byCat)
      .map(cat => ({
        name: cat,
        amount: Math.round(byCat[cat]),
        percentage: total > 0 ? Math.round((byCat[cat] / total) * 100) : 0,
        icon: this.getCategoryIcon(cat),
      }))
      .sort((a, b) => b.amount - a.amount);
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
      case 'groceries': return '🛒';
      case 'travel': return '✈️';
      case 'fuel': return '⛽';
      case 'entertainment': return '🎬';
      case 'health': return '💊';
      case 'education': return '📚';
      case 'emi': return '🏦';
      default: return '📦';
    }
  }

  prepareRecentExpenses(expenses: any[]) {
    const sorted = [...expenses].sort((a, b) => ms(b.date) - ms(a.date));
    this.allExpenses = sorted;
    this.recentExpenses = sorted.slice(0, 5);
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
    const e = this.allExpenses.find(x => x.id === id);
    this.undo.defer(`Deleted "${e?.description ?? 'expense'}"`, [id], () => this.expenseService.deleteExpense(id));
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
    const sorted = [...income].sort((a, b) => ms(b.date) - ms(a.date));
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
    this.undo.defer(`Deleted income "${income?.source ?? ''}"`, [id], () => this.incomeService.deleteIncome(id));
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
