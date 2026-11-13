import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { switchMap } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { CarryForwardService } from '../../services/carry-forward.service';
import { SpendingService } from '../../services/spending.service';
import { SettingsService } from '../../services/settings.service';
import { UndoService } from '../../services/undo.service';
import { QuickActionsService } from '../../core/quick-actions.service';
import { AccountSummary, parseRef } from '../../models/account.model';
import { RecurringPayment, statusOf } from '../../models/recurring.model';
import { LendingRecord, lendingDue } from '../../models/lending.model';
import { DEFAULT_SETTINGS } from '../../models/settings.model';
import {
  DateRange,
  FinanceTxn,
  RANGE_PRESETS,
  RangePreset,
  Series,
  byCategory,
  categoryIcon,
  dailyInsight,
  dailySeries,
  habits,
  inRange,
  inr,
  monthlySeries,
  monthsIn,
  rangeFor,
  totals,
  touches,
} from '../../utils/analytics.util';
import { summarize } from '../../utils/spending.util';
import { MoneyItem, summarizeMonth, walletMoneyItem } from '../../utils/budget.util';
import { BudgetHeroComponent } from '../../components/budget-hero/budget-hero.component';
import { fromDateInput, monthKey, toDateInput } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';
import { MetricCardComponent } from '../../ui/metric-card.component';
import { ChartComponent, ChartPick } from '../../ui/chart.component';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { MoneyPipe, MoneyShortPipe } from '../../ui/money.pipe';
import { BreakdownComponent } from '../../components/breakdown/breakdown.component';

const FILTER_KEY = 'ssb_dash_filter';

/**
 * Dashboard — the financial overview. Everything below the filters reacts to the selected date
 * range and account. Data comes from FinanceService (Firestore, live); nothing is mocked.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, IconComponent, MetricCardComponent, ChartComponent, SkeletonComponent,
    EmptyStateComponent, MoneyPipe, MoneyShortPipe, BudgetHeroComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private auth = inject(AuthService);
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private carryForward = inject(CarryForwardService);
  private spending = inject(SpendingService);
  private settingsService = inject(SettingsService);
  private undo = inject(UndoService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  quick = inject(QuickActionsService);

  readonly presets = RANGE_PRESETS;
  readonly catIcon = categoryIcon;
  readonly today = new Date();

  // ── Filters ────────────────────────────────────────────────────
  private saved = readFilter();
  preset = signal<RangePreset>(this.saved.preset ?? 'month');
  customStart = signal<string>(this.saved.start ?? toDateInput(new Date(this.today.getFullYear(), this.today.getMonth(), 1)));
  customEnd = signal<string>(this.saved.end ?? toDateInput(this.today));
  accountKey = signal<string>(this.saved.account ?? '');
  trendMonths = signal<3 | 6 | 12>(6);

  range = computed<DateRange>(() =>
    rangeFor(this.preset(), this.today, {
      start: fromDateInput(this.customStart()) ?? this.today,
      end: fromDateInput(this.customEnd()) ?? this.today,
    })
  );
  accountRef = computed(() => parseRef(this.accountKey()));

  /** One Firestore window covering the selected range AND the last 12 months (trends, habits). */
  private window = computed(() => {
    const r = this.range();
    const twelve = new Date(this.today.getFullYear(), this.today.getMonth() - 11, 1);
    const nextMonth = new Date(this.today.getFullYear(), this.today.getMonth() + 1, 1);
    const start = r.start < twelve ? r.start : twelve;
    const end = r.end > nextMonth ? r.end : nextMonth;
    return { start, end, key: `${start.getTime()}-${end.getTime()}` };
  });
  private windowKey = computed(() => this.window().key);
  private all = toSignal(
    toObservable(this.windowKey).pipe(switchMap(() => this.finance.window$(this.window().start, this.window().end)))
  );
  loading = computed(() => this.all() === undefined);

  // ── Reference data ─────────────────────────────────────────────
  accounts = toSignal(this.finance.accounts$);
  accountMap = toSignal(this.finance.accountMap$, { initialValue: new Map<string, AccountSummary>() });
  activeAccounts = computed(() => (this.accounts() ?? []).filter(a => a.status === 'Active'));
  wealth = toSignal(this.finance.wealth$);
  commitments = toSignal(this.finance.commitments$(30));
  recurring = toSignal(this.finance.recurring$, { initialValue: [] as RecurringPayment[] });
  lending = toSignal(this.finance.lending$, { initialValue: [] as LendingRecord[] });
  settings = toSignal(this.settingsService.settings$, { initialValue: DEFAULT_SETTINGS });
  recentSpend = toSignal(this.spending.recent$, { initialValue: [] });

  selectedAccount = computed(() => (this.accountKey() ? this.accountMap().get(this.accountKey()) ?? null : null));

  // ── Derived analytics ─────────────────────────────────────────
  scoped = computed(() => (this.all() ?? []).filter(t => touches(t, this.accountRef())));
  inPeriod = computed(() => this.scoped().filter(t => inRange(t, this.range())));
  sum = computed(() => totals(this.inPeriod()));
  categories = computed(() => byCategory(this.inPeriod(), 'spend'));
  topCategories = computed(() => this.categories().slice(0, 6));
  donutLabels = computed(() => this.topCategories().map(c => c.name));
  donutSeries = computed(() => [{ label: 'Spending', data: this.topCategories().map(c => c.amount), color: '--c1' }]);
  carryForwardInPeriod = computed(() => this.inPeriod().filter(t => t.carryForward).reduce((s, t) => s + t.amount, 0));

  /** Cash-flow chart: by day for ranges up to ~2 months, by month beyond that. */
  flow = computed<Series>(() => {
    const r = this.range();
    const days = (r.end.getTime() - r.start.getTime()) / 86_400_000;
    return days <= 62 ? dailySeries(this.inPeriod(), r) : monthlySeries(this.inPeriod(), monthsIn(r.start, r.end));
  });
  flowIsDaily = computed(() => (this.range().end.getTime() - this.range().start.getTime()) / 86_400_000 <= 62);
  flowSeries = computed(() => [
    { label: 'Income', data: this.flow().income, color: '--pos' },
    { label: 'Spending', data: this.flow().spent, color: '--c2' },
    ...(this.flowIsDaily() ? [] : [{ label: 'Net', data: this.flow().net, color: '--c3', kind: 'line' as const }]),
  ]);

  trend = computed<Series>(() => {
    const n = this.trendMonths();
    const months = monthsIn(new Date(this.today.getFullYear(), this.today.getMonth() - n + 1, 1), new Date(this.today.getFullYear(), this.today.getMonth() + 1, 1));
    return monthlySeries(this.scoped(), months);
  });
  trendSeries = computed(() => [
    { label: 'Income', data: this.trend().income, color: '--pos' },
    { label: 'Spending', data: this.trend().spent, color: '--c2' },
    { label: 'Net', data: this.trend().net, color: '--c3', kind: 'line' as const },
  ]);
  trendSummary = computed(() => {
    const t = this.trend();
    const months = t.keys.length;
    const inc = t.income.reduce((a, b) => a + b, 0);
    const sp = t.spent.reduce((a, b) => a + b, 0);
    return { avgIncome: inc / months, avgSpent: sp / months, saved: inc - sp, rate: inc > 0 ? Math.round(((inc - sp) / inc) * 100) : null };
  });

  daily = computed(() => dailyInsight(this.scoped(), this.range(), this.today));
  habit = computed(() => habits(this.all() ?? [], monthlySeries(this.all() ?? [], monthsIn(new Date(this.today.getFullYear(), this.today.getMonth() - 11, 1), new Date(this.today.getFullYear(), this.today.getMonth() + 1, 1))), this.today));
  pulse = computed(() => {
    const since = this.auth.account()?.createdAt ?? new Date(this.today.getFullYear(), this.today.getMonth() - 2, 1);
    return summarize(this.recentSpend(), this.settings().dailyLimit, this.today, since);
  });
  maxCal = computed(() => Math.max(1, ...this.habit().calendar.map(c => c.count)));

  recent = computed(() => this.inPeriod().slice(0, 8));

  /** Monthly budget pace (the original Overview hero) for the selected month — all accounts only. */
  budgetMonth = computed(() => (this.preset() === 'month' || this.preset() === 'prev-month') && !this.accountKey() ? monthKey(this.range().start) : null);
  budget = computed(() => {
    const m = this.budgetMonth();
    const all = this.all();
    if (!m || !all) return null;
    const [y, mm] = m.split('-').map(Number);
    const prev = monthKey(new Date(y, mm - 2, 1));
    const items = (key: string) => all.filter(t => monthKey(t.date) === key && t.kind !== 'income' && t.kind !== 'transfer').map(toMoneyItem);
    const income = all.filter(t => t.kind === 'income' && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0);
    return summarizeMonth(m, income, items(m), items(prev), this.today);
  });
  budgetLabel = computed(() => this.range().label);

  bills = computed(() =>
    this.recurring()
      .filter(p => !p.paused)
      .map(p => ({ p, s: statusOf(p, this.today) }))
      .filter(x => x.s.days <= 30)
      .slice(0, 5)
  );

  lendSummary = computed(() => {
    const list = this.lending();
    const open = list.filter(r => r.status === 'PENDING');
    const lent = list.filter(r => r.direction === 'lent');
    const borrowed = list.filter(r => r.direction === 'borrowed');
    return {
      owedToMe: round(open.filter(r => r.direction === 'lent').reduce((s, r) => s + r.outstanding, 0)),
      iOwe: round(open.filter(r => r.direction === 'borrowed').reduce((s, r) => s + r.outstanding, 0)),
      totalLent: round(lent.reduce((s, r) => s + r.amount, 0)),
      received: round(lent.reduce((s, r) => s + r.settled, 0)),
      totalBorrowed: round(borrowed.reduce((s, r) => s + r.amount, 0)),
      repaid: round(borrowed.reduce((s, r) => s + r.settled, 0)),
      open: open.slice(0, 5),
      count: open.length,
    };
  });
  lendDue = lendingDue;

  greeting = computed(() => {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const name = this.auth.account()?.displayName?.trim().split(/\s+/)[0] || this.auth.account()?.email?.split('@')[0] || '';
    return name ? `${part}, ${name}` : part;
  });

  encouragement = computed(() => {
    const h = this.habit();
    const p = this.pulse();
    if (h.loggingStreak >= 7) return `Great work — ${h.loggingStreak} days in a row with your money logged.`;
    if (p.limit && p.withinLimitStreak >= 3) return `${p.withinLimitStreak} days in a row within your daily limit. You're building better habits.`;
    if (h.positiveMonths >= 2) return `${h.positiveMonths} months in a row where you earned more than you spent.`;
    if (h.loggedToday) return 'You’ve logged today’s activity — consistency is what makes the numbers useful.';
    if (h.loggingStreak >= 2) return `${h.loggingStreak}-day logging streak. Add today’s entries to keep it going.`;
    return 'Log what you spend each day and your streaks will start showing here.';
  });

  constructor() {
    effect(() => {
      try {
        sessionStorage.setItem(FILTER_KEY, JSON.stringify({ preset: this.preset(), start: this.customStart(), end: this.customEnd(), account: this.accountKey() }));
      } catch { /* ignore */ }
    });
    // A selected account that disappears (deleted) falls back to "All accounts".
    effect(() => {
      const list = this.accounts();
      if (list && this.accountKey() && !list.some(a => a.key === this.accountKey())) this.accountKey.set('');
    });
  }

  ngOnInit(): void {
    // Existing behaviour kept: sync last month's closing balance into this month (current month only).
    this.auth.ready().then(() =>
      this.carryForward.checkAndProcessCarryForward(monthKey(this.today)).catch(err => console.warn('[Dashboard] carry-forward', err))
    );
  }

  // ── Actions ───────────────────────────────────────────────────
  setPreset(p: RangePreset): void {
    this.preset.set(p);
  }

  openAccount(a: AccountSummary): void {
    this.router.navigate(['/account', a.type, a.ref.id]);
  }

  openTxn(t: FinanceTxn): void {
    this.quick.showTxn(t);
  }

  /** Clicking a bar opens the breakdown of that day / month. */
  pickFlow(p: ChartPick): void {
    const s = this.flow();
    const key = s.keys[p.index];
    if (!key) return;
    const list = this.inPeriod().filter(t => (this.flowIsDaily() ? dayKeyOf(t.date) === key : monthKey(t.date) === key));
    this.openBreakdown(s.labels[p.index], list);
  }

  pickTrend(p: ChartPick): void {
    const key = this.trend().keys[p.index];
    if (!key) return;
    this.openBreakdown(this.trend().labels[p.index], this.scoped().filter(t => monthKey(t.date) === key));
  }

  pickCategory(name: string): void {
    this.openBreakdown(`${name} · ${this.range().label}`, this.inPeriod().filter(t => t.category === name && t.spend !== 0));
  }

  pickDoughnut(p: ChartPick): void {
    const c = this.topCategories()[p.index];
    if (c) this.pickCategory(c.name);
  }

  private openBreakdown(title: string, txns: FinanceTxn[]): void {
    this.dialog.open(BreakdownComponent, { data: { title, txns }, width: 'min(100vw, 520px)', panelClass: 'ss-drawer-pane', autoFocus: 'dialog' });
  }

  payBill(p: RecurringPayment): void {
    this.undo.defer(
      `Paid "${p.description}" · ${inr(p.amount)}${p.frequency === 'once' ? '' : ' · next due moved on'}`,
      p.frequency === 'once' ? [p.id] : [],
      () => this.ledger.payRecurring(p)
    );
  }

  settle(r: LendingRecord): void {
    this.undo.defer(
      `${r.direction === 'lent' ? `${r.person} repaid` : `You repaid ${r.person}`} ${inr(r.outstanding)}${r.direction === 'lent' && r.trackInExpenses ? ' · added to income' : ''}`,
      [r.id],
      () => this.ledger.settleLending(r, r.outstanding, r.account)
    );
  }

  accountName(t: FinanceTxn): string {
    if (t.kind === 'transfer') {
      const a = this.accountMap().get(`${t.account?.type}:${t.account?.id}`);
      const b = this.accountMap().get(`${t.account2?.type}:${t.account2?.id}`);
      return `${a?.name ?? '—'} → ${b?.name ?? '—'}`;
    }
    if (!t.account) return 'No account';
    return this.accountMap().get(`${t.account.type}:${t.account.id}`)?.name ?? 'Deleted account';
  }

  trackKey = (_: number, t: FinanceTxn) => t.key;
}

function toMoneyItem(t: FinanceTxn): MoneyItem {
  if (t.kind === 'wallet') return walletMoneyItem(t.raw);
  if (t.kind === 'card') return { source: 'card', amount: t.amount, date: t.date, category: t.category, direction: t.raw?.direction };
  return { source: 'expense', amount: t.amount, date: t.date, category: t.raw?.category, status: t.raw?.status };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function readFilter(): { preset?: RangePreset; start?: string; end?: string; account?: string } {
  try {
    return JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}');
  } catch {
    return {};
  }
}
