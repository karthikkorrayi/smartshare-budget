import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, map, switchMap } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { WalletsService } from '../../services/wallets.service';
import { CardsService } from '../../services/cards.service';
import { CardInsightsService } from '../../services/card-insights.service';
import { CardOverviewComponent } from '../../components/card-overview/card-overview.component';
import { QuickActionsService } from '../../core/quick-actions.service';
import { AccountRef, AccountSummary, AccountType, refKey } from '../../models/account.model';
import {
  FinanceTxn,
  RANGE_PRESETS,
  RangePreset,
  byCategory,
  dailySeries,
  monthlySeries,
  monthsIn,
  rangeFor,
  totals,
  touches,
} from '../../utils/analytics.util';
import { monthKey } from '../../utils/date-input.util';
import { balanceAt, balanceSeries, largest, topPayees } from '../../utils/account-insights.util';
import { occurrencesBetween } from '../../models/recurring.model';
import { DatePipe } from '@angular/common';
import { IconComponent } from '../../ui/icon.component';
import { MetricCardComponent } from '../../ui/metric-card.component';
import { ChartComponent, ChartPick } from '../../ui/chart.component';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { MoneyPipe, MoneyShortPipe } from '../../ui/money.pipe';
import { TxnTableComponent } from '../../components/txn-table/txn-table.component';
import { BreakdownComponent } from '../../components/breakdown/breakdown.component';
import { AmountComponent } from '../../ui/amount.component';
import { PrivacyService } from '../../core/privacy.service';

/** One account's analytics: balance, money in vs out over time, category split, and its transactions. */
@Component({
  standalone: true,
  imports: [CardOverviewComponent, DatePipe, RouterLink, IconComponent, MetricCardComponent, ChartComponent, SkeletonComponent, EmptyStateComponent, MoneyPipe, MoneyShortPipe, TxnTableComponent, AmountComponent],
  templateUrl: './account-detail.component.html',
  styleUrl: './account-detail.component.scss',
})
export class AccountDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private finance = inject(FinanceService);
  private dialog = inject(MatDialog);
  private walletsService = inject(WalletsService);
  private cardsService = inject(CardsService);
  private cardInsights = inject(CardInsightsService);
  private cardMap = toSignal(this.cardInsights.byId$);
  /** Credit card overview data (limit, cycle, costs, rewards) when this account is a card. */
  cardData = computed(() => {
    const r = this.ref();
    return r?.type === 'card' ? this.cardMap()?.get(r.id) ?? null : null;
  });
  quick = inject(QuickActionsService);
  private privacy = inject(PrivacyService);

  readonly presets = RANGE_PRESETS.filter(p => p.id !== 'custom' && p.id !== 'today');
  readonly today = new Date();

  ref = toSignal(this.route.paramMap.pipe(map(p => ({ type: p.get('type') as AccountType, id: p.get('id') ?? '' }) as AccountRef)), {
    initialValue: null,
  });
  accountMap = toSignal(this.finance.accountMap$);
  account = computed<AccountSummary | null | undefined>(() => {
    const m = this.accountMap();
    const r = this.ref();
    if (!m || !r) return undefined;
    return m.get(refKey(r)) ?? null;
  });

  preset = signal<RangePreset>('6m');
  range = computed(() => rangeFor(this.preset(), this.today));
  private key = computed(() => `${this.range().start.getTime()}-${this.range().end.getTime()}`);
  /** From the period start up to today (balances are worked back from today's). */
  private raw = toSignal(toObservable(this.key).pipe(switchMap(() => this.finance.window$(this.range().start, this.tomorrow))));
  private readonly tomorrow = new Date(this.today.getFullYear(), this.today.getMonth(), this.today.getDate() + 1);

  /** Everything touching this account from the period start to today. */
  private since = computed<FinanceTxn[] | null>(() => {
    const r = this.raw();
    const ref = this.ref();
    return r && ref ? r.filter(t => touches(t, ref)) : null;
  });
  /** The selected period only. */
  txns = computed<FinanceTxn[] | null>(() => {
    const s = this.since();
    const end = this.range().end;
    return s ? s.filter(t => t.date < end) : null;
  });

  // ── Phase 6: balance history and insights ─────────────────────
  /** Bank / wallet balances can be worked back exactly from transactions (card dues can't — see the card overview). */
  hasBalanceHistory = computed(() => this.account()?.type === 'bank' || this.account()?.type === 'wallet');
  opening = computed(() => {
    const a = this.account(), s = this.since();
    return a && s && this.hasBalanceHistory() ? balanceAt(a.balance, a.ref, s, this.range().start) : null;
  });
  closing = computed(() => {
    const a = this.account(), s = this.since();
    if (!a || !s || !this.hasBalanceHistory()) return null;
    return this.range().end >= this.tomorrow ? a.balance : balanceAt(a.balance, a.ref, s, this.range().end);
  });
  balanceChart = computed(() => {
    const a = this.account(), s = this.since();
    if (!a || !s || !this.hasBalanceHistory()) return null;
    const ends = this.series().keys.map(k => (k.length === 10 ? new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8) + 1) : new Date(+k.slice(0, 4), +k.slice(5, 7), 1)));
    return [{ label: 'Balance', data: balanceSeries(a.balance, a.ref, s, ends, new Date()), color: '--c1', kind: 'line' as const }];
  });
  payees = computed(() => topPayees(this.txns() ?? [], 5));
  biggest = computed(() => (this.account() ? largest(this.txns() ?? [], this.account()!.ref, 5) : []));
  avgMonthlySpend = computed(() => {
    const r = this.range();
    const end = r.end < this.tomorrow ? r.end : this.tomorrow;
    const months = Math.max(1, (end.getTime() - r.start.getTime()) / (30.44 * 86_400_000));
    return Math.round((this.sum().spent / months) * 100) / 100;
  });
  private plans = toSignal(this.finance.recurring$, { initialValue: [] });
  /** Bills, subscriptions and EMIs paid from this account in the next 30 days. */
  upcoming = computed(() => {
    const ref = this.ref();
    if (!ref) return [];
    const until = new Date(this.today.getFullYear(), this.today.getMonth(), this.today.getDate() + 30);
    return this.plans()
      .filter(p => !p.paused && !p.completed && p.account && refKey(p.account) === refKey(ref))
      .flatMap(p => occurrencesBetween(p, this.today, until, true).map(date => ({ p, date })))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });
  upcomingTotal = computed(() => Math.round(this.upcoming().reduce((s, x) => s + x.p.amount, 0) * 100) / 100);
  /** For transfers, money in / out depends on which side this account is. */
  sum = computed(() => {
    const list = this.txns() ?? [];
    const base = totals(list);
    const ref = this.ref()!;
    let tin = 0, tout = 0;
    for (const t of list) if (t.kind === 'transfer') { if (refKey(t.account2) === refKey(ref)) tin += t.amount; else tout += t.amount; }
    return { ...base, transfersIn: tin, transfersOut: tout };
  });
  isDaily = computed(() => (this.range().end.getTime() - this.range().start.getTime()) / 86_400_000 <= 62);
  series = computed(() => (this.isDaily() ? dailySeries(this.txns() ?? [], this.range()) : monthlySeries(this.txns() ?? [], monthsIn(this.range().start, this.range().end))));
  chartSeries = computed(() => [
    { label: this.account()?.type === 'card' ? 'Refunds' : 'Money in', data: this.series().income.map((v, i) => v + this.refundsAt(i)), color: '--pos' },
    { label: 'Spending', data: this.series().spent.map((v, i) => v + this.refundsAt(i)), color: '--c2' },
    { label: 'Net', data: this.series().net, color: '--c3', kind: 'line' as const },
  ]);
  cats = computed(() => byCategory(this.txns() ?? [], 'spend').slice(0, 7));
  catLabels = computed(() => this.cats().map(c => c.name));
  catSeries = computed(() => [{ label: 'Spending', data: this.cats().map(c => c.amount), color: '--c1' }]);
  selectedBar = signal<number | null>(null);

  /** Refunds are negative spending; show them as money in on the chart instead of shrinking the spend bar. */
  private refundsAt(i: number): number {
    const key = this.series().keys[i];
    return (this.txns() ?? [])
      .filter(t => t.spend < 0 && (this.isDaily() ? dk(t.date) === key : monthKey(t.date) === key))
      .reduce((s, t) => s - t.spend, 0);
  }

  pick(p: ChartPick): void {
    this.selectedBar.set(p.index);
    const key = this.series().keys[p.index];
    const list = (this.txns() ?? []).filter(t => (this.isDaily() ? dk(t.date) === key : monthKey(t.date) === key));
    this.dialog
      .open(BreakdownComponent, { data: { title: `${this.account()?.name} · ${this.series().labels[p.index]}`, txns: list }, width: 'min(100vw, 520px)', panelClass: 'ss-drawer-pane' })
      .afterClosed()
      .subscribe(() => this.selectedBar.set(null));
  }

  pickCat(p: ChartPick): void {
    const c = this.cats()[p.index];
    if (!c) return;
    const list = (this.txns() ?? []).filter(t => t.category === c.name && t.spend !== 0);
    this.dialog.open(BreakdownComponent, { data: { title: `${c.name} · ${this.account()?.name}`, txns: list }, width: 'min(100vw, 520px)', panelClass: 'ss-drawer-pane' });
  }

  async edit(): Promise<void> {
    const a = this.account();
    if (!a) return;
    if (a.type === 'bank') return void this.quick.editBank(a.ref.id);
    if (a.type === 'wallet') {
      const w = (await firstValueFrom(this.walletsService.wallets$)).find(x => x.id === a.ref.id);
      const { WalletFormComponent } = await import('../../dialogs/wallet-form/wallet-form.component');
      this.dialog.open(WalletFormComponent, { data: { wallet: w }, width: 'min(96vw, 520px)' });
      return;
    }
    await this.editCard(0);
  }

  /** Opens the card form at a step (0 card, 1 limits & billing, 2 costs & rewards, 3 settings). */
  async editCard(step: number): Promise<void> {
    const a = this.account();
    if (!a || a.type !== 'card') return;
    const c = (await firstValueFrom(this.cardsService.cards$)).find(x => x.id === a.ref.id);
    const { CardFormComponent } = await import('../../dialogs/card-form/card-form.component');
    this.dialog.open(CardFormComponent, { data: { card: c, step }, width: 'min(96vw, 600px)', panelClass: 'ss-sheet-pane' });
  }

  privacyShown(key: string): boolean {
    return this.privacy.isVisible(key);
  }

  back(): void {
    this.router.navigateByUrl('/');
  }
}

function dk(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
