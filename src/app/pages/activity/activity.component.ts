import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { map, switchMap } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { ReviewService } from '../../services/review.service';
import { UndoService } from '../../services/undo.service';
import { QuickActionsService } from '../../core/quick-actions.service';
import { ConfirmService } from '../../ui/confirm.service';
import { AccountSummary, parseRef, refKey } from '../../models/account.model';
import { LendingRecord, lendingDue } from '../../models/lending.model';
import {
  FinanceTxn,
  RANGE_PRESETS,
  RangePreset,
  byCategory,
  categoryIcon,
  inr,
  rangeFor,
  totals,
  touches,
} from '../../utils/analytics.util';
import { fromDateInput, toDateInput } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';
import { MetricCardComponent } from '../../ui/metric-card.component';
import { MoneyPipe } from '../../ui/money.pipe';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { TxnTableComponent } from '../../components/txn-table/txn-table.component';
import { BreakdownComponent } from '../../components/breakdown/breakdown.component';

type Section = 'all' | 'expenses' | 'income' | 'transfers' | 'lending' | 'categories' | 'accounts';

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, IconComponent, MetricCardComponent, MoneyPipe, SkeletonComponent, EmptyStateComponent, TxnTableComponent],
  templateUrl: './activity.component.html',
  styleUrl: './activity.component.scss',
})
export class ActivityComponent {
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);
  private confirm = inject(ConfirmService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  quick = inject(QuickActionsService);

  readonly presets = RANGE_PRESETS;
  readonly catIcon = categoryIcon;
  readonly lendDue = lendingDue;
  readonly today = new Date();
  readonly sections: { id: Section; label: string; icon: string }[] = [
    { id: 'all', label: 'All transactions', icon: 'list-checks' },
    { id: 'expenses', label: 'Expenses', icon: 'arrow-up-right' },
    { id: 'income', label: 'Income', icon: 'arrow-down-left' },
    { id: 'transfers', label: 'Transfers & moves', icon: 'arrow-left-right' },
    { id: 'lending', label: 'Lending & borrowing', icon: 'handshake' },
    { id: 'categories', label: 'Categories', icon: 'tag' },
    { id: 'accounts', label: 'Account activity', icon: 'landmark' },
  ];

  section = signal<Section>('all');
  preset = signal<RangePreset>('month');
  customStart = signal(toDateInput(new Date(this.today.getFullYear(), this.today.getMonth(), 1)));
  customEnd = signal(toDateInput(this.today));
  accountKey = signal('');

  range = computed(() =>
    rangeFor(this.preset(), this.today, { start: fromDateInput(this.customStart()) ?? this.today, end: fromDateInput(this.customEnd()) ?? this.today })
  );
  private rangeKey = computed(() => `${this.range().start.getTime()}-${this.range().end.getTime()}`);
  private raw = toSignal(toObservable(this.rangeKey).pipe(switchMap(() => this.finance.window$(this.range().start, this.range().end))));
  accountMap = toSignal(this.finance.accountMap$, { initialValue: new Map<string, AccountSummary>() });
  accounts = toSignal(this.finance.accounts$, { initialValue: [] as AccountSummary[] });
  lending = toSignal(this.finance.lending$, { initialValue: [] as LendingRecord[] });
  pending = toSignal(inject(ReviewService).pending$.pipe(map(p => p.length)), { initialValue: 0 });

  /** Hidden while a delete is waiting for its Undo window. */
  txns = computed<FinanceTxn[] | null>(() => {
    const r = this.raw();
    if (!r) return null;
    const ref = parseRef(this.accountKey());
    const hidden = this.undo.hidden();
    return r.filter(t => touches(t, ref) && !hidden.has(t.id));
  });
  sum = computed(() => totals(this.txns() ?? []));
  expenses = computed(() => (this.txns() ?? []).filter(t => t.flow === 'out' || (t.kind !== 'income' && t.spend < 0)));
  income = computed(() => (this.txns() ?? []).filter(t => t.kind === 'income'));
  moves = computed(() => (this.txns() ?? []).filter(t => t.flow === 'move'));
  cats = computed(() => {
    const list = this.txns() ?? [];
    return byCategory(list, 'spend').map(c => ({ ...c, count: list.filter(t => t.category === c.name && t.spend > 0).length }));
  });
  incomeCats = computed(() => byCategory(this.txns() ?? [], 'income'));
  perAccount = computed(() => {
    const list = this.txns() ?? [];
    return this.accounts().map(a => {
      const mine = list.filter(t => refKey(t.account) === a.key || refKey(t.account2) === a.key);
      const t = totals(mine);
      return { a, inflow: t.income, out: t.spent, net: t.net, count: mine.length };
    }).filter(x => x.count || x.a.status === 'Active');
  });
  unlinked = computed(() => (this.txns() ?? []).filter(t => !t.account && t.kind !== 'transfer' && !t.system).length);

  lendOpen = computed(() => this.lending().filter(r => r.status === 'PENDING' && !this.undo.hidden().has(r.id)));
  lendClosed = computed(() => this.lending().filter(r => r.status === 'PAID').slice(0, 20));
  settleAmount: Record<string, number | null> = {};

  openCategory(name: string): void {
    const list = (this.txns() ?? []).filter(t => t.category === name);
    this.dialog.open(BreakdownComponent, { data: { title: `${name} · ${this.range().label}`, txns: list }, width: 'min(100vw, 520px)', panelClass: 'ss-drawer-pane' });
  }

  openAccount(a: AccountSummary): void {
    this.router.navigate(['/account', a.type, a.ref.id]);
  }

  settle(r: LendingRecord): void {
    const amt = Number(this.settleAmount[r.id] ?? r.outstanding);
    if (!(amt > 0)) return;
    const pay = Math.min(amt, r.outstanding);
    const full = pay >= r.outstanding;
    this.undo.defer(
      `${r.direction === 'lent' ? `${r.person} repaid` : `You repaid ${r.person}`} ${inr(pay)}${full ? ' · settled' : ''}`,
      full ? [r.id] : [],
      () => this.ledger.settleLending(r, pay, r.account)
    );
    this.settleAmount[r.id] = null;
  }

  async removeLending(r: LendingRecord): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete the record for ${r.person}?`,
      message: r.status === 'PENDING' && r.trackInExpenses ? 'Its “Lent” expense is removed as well.' : 'Only this ledger entry is removed.',
      confirm: 'Delete',
      danger: true,
    });
    if (ok) this.undo.defer(`Deleted record for ${r.person}`, [r.id], () => this.ledger.deleteLending(r));
  }
}
