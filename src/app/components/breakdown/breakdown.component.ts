import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FinanceService } from '../../services/finance.service';
import { QuickActionsService } from '../../core/quick-actions.service';
import { FinanceTxn, byCategory, categoryIcon, totals } from '../../utils/analytics.util';
import { refKey } from '../../models/account.model';
import { IconComponent } from '../../ui/icon.component';
import { ChartComponent } from '../../ui/chart.component';
import { MoneyPipe, MoneyShortPipe } from '../../ui/money.pipe';
import { EmptyStateComponent } from '../../ui/empty-state.component';

/** Drill-down for a chart bar / category: totals, income & spending by category, and the transactions. */
@Component({
  standalone: true,
  imports: [DatePipe, IconComponent, ChartComponent, MoneyPipe, MoneyShortPipe, EmptyStateComponent],
  template: `
    <div class="dlg drawer" role="dialog" aria-modal="true" [attr.aria-label]="'Breakdown for ' + data.title">
      <div class="dlg-head">
        <span class="icon-tile lg accent"><app-icon name="chart-pie" [size]="22" /></span>
        <div><h2>{{ data.title }}</h2><p>{{ t().count }} entr{{ t().count === 1 ? 'y' : 'ies' }}</p></div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>
      <div class="dlg-body">
        <div class="tot">
          <div class="in"><span>Money in</span><b class="num">{{ t().income | money }}</b></div>
          <div class="out"><span>Spending</span><b class="num">{{ t().spent | money }}</b></div>
          <div><span>Net</span><b class="num" [class.amt-neg]="t().net < 0">{{ t().net | money }}</b></div>
        </div>

        @if (!data.txns.length) {
          <app-empty art="range" [compact]="true" title="Nothing recorded here" />
        } @else {
          @if (spend().length) {
            <h3 class="h">Spending by category</h3>
            <div class="donut">
              <app-chart type="doughnut" [labels]="spendLabels()" [series]="spendSeries()" [height]="160" cutout="68%" ariaLabel="Spending by category" />
              <div class="center"><b class="num">{{ t().spent | moneyShort }}</b></div>
            </div>
            <div class="rows">
              @for (c of spend(); track c.name) {
                <div class="r"><span class="dot" [style.background]="c.color"></span><app-icon [name]="c.icon" [size]="14" /><span class="grow">{{ c.name }}</span><span class="muted tiny">{{ c.pct }}%</span><b class="num">{{ c.amount | money }}</b></div>
              }
            </div>
          }
          @if (income().length) {
            <h3 class="h">Income by source</h3>
            <div class="rows">
              @for (c of income(); track c.name) {
                <div class="r"><span class="dot" style="background: var(--pos)"></span><app-icon [name]="c.icon" [size]="14" /><span class="grow">{{ c.name }}</span><b class="num amt-in">{{ c.amount | money }}</b></div>
              }
            </div>
          }
          <h3 class="h">Transactions</h3>
          <div class="list">
            @for (x of sorted(); track x.key) {
              <button class="list-row" (click)="open(x)">
                <span class="icon-tile sm" [class.pos]="x.flow === 'in'" [class.info]="x.flow === 'move'"><app-icon [name]="x.kind === 'transfer' ? 'arrow-left-right' : catIcon(x.category)" [size]="15" /></span>
                <span class="grow"><span class="title">{{ x.title }}</span><span class="sub">{{ x.category }} · {{ name(x) }} · {{ x.date | date: 'd MMM' }}</span></span>
                <span class="num" [class.amt-in]="x.flow === 'in'" [class.amt-move]="x.flow === 'move'">{{ x.flow === 'in' ? '+' : x.flow === 'out' ? '−' : '' }}{{ x.amount | money }}</span>
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .drawer { height: 100%; max-height: 100dvh; }
    .tot { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
      > div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); }
      span { font-size: 11.5px; color: var(--text-3); } b { font-size: 16px; }
      .in b { color: var(--pos); } }
    .h { margin: 8px 0 -4px; font-size: 13px; font-weight: 650; color: var(--text-2); }
    .donut { position: relative; } .center { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; font-size: 16px; }
    .rows { display: flex; flex-direction: column; }
    .r { display: flex; align-items: center; gap: 8px; padding: 7px 2px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-2);
      .grow { flex: 1; min-width: 0; } b { color: var(--text); } &:last-child { border-bottom: 0; } }
    @media (max-width: 640px) { .drawer { height: auto; } }
  `],
})
export class BreakdownComponent {
  data = inject<{ title: string; txns: FinanceTxn[] }>(MAT_DIALOG_DATA);
  ref = inject(MatDialogRef<BreakdownComponent>);
  private quick = inject(QuickActionsService);
  private map = toSignal(inject(FinanceService).accountMap$);
  readonly catIcon = categoryIcon;

  t = computed(() => totals(this.data.txns));
  spend = computed(() => byCategory(this.data.txns, 'spend'));
  income = computed(() => byCategory(this.data.txns, 'income'));
  spendLabels = computed(() => this.spend().map(c => c.name));
  spendSeries = computed(() => [{ label: 'Spending', data: this.spend().map(c => c.amount), color: '--c1' }]);
  sorted = computed(() => [...this.data.txns].sort((a, b) => b.amount - a.amount));

  name(t: FinanceTxn): string {
    if (!t.account) return 'No account';
    return this.map()?.get(refKey(t.account))?.name ?? '—';
  }

  open(t: FinanceTxn): void {
    this.quick.showTxn(t);
  }
}
