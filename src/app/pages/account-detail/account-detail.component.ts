import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, map, switchMap } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { WalletsService } from '../../services/wallets.service';
import { CardsService } from '../../services/cards.service';
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
import { IconComponent } from '../../ui/icon.component';
import { MetricCardComponent } from '../../ui/metric-card.component';
import { ChartComponent, ChartPick } from '../../ui/chart.component';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { MoneyPipe, MoneyShortPipe } from '../../ui/money.pipe';
import { TxnTableComponent } from '../../components/txn-table/txn-table.component';
import { BreakdownComponent } from '../../components/breakdown/breakdown.component';

/** One account's analytics: balance, money in vs out over time, category split, and its transactions. */
@Component({
  standalone: true,
  imports: [RouterLink, IconComponent, MetricCardComponent, ChartComponent, SkeletonComponent, EmptyStateComponent, MoneyPipe, MoneyShortPipe, TxnTableComponent],
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
  quick = inject(QuickActionsService);

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
  private raw = toSignal(toObservable(this.key).pipe(switchMap(() => this.finance.window$(this.range().start, this.range().end))));

  txns = computed<FinanceTxn[] | null>(() => {
    const r = this.raw();
    const ref = this.ref();
    return r && ref ? r.filter(t => touches(t, ref)) : null;
  });
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
    const c = (await firstValueFrom(this.cardsService.cards$)).find(x => x.id === a.ref.id);
    const { CardFormComponent } = await import('../../dialogs/card-form/card-form.component');
    this.dialog.open(CardFormComponent, { data: { card: c }, width: 'min(96vw, 560px)' });
  }

  back(): void {
    this.router.navigateByUrl('/');
  }
}

function dk(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
