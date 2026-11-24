import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { UndoService } from '../../services/undo.service';
import { QuickActionsService } from '../../core/quick-actions.service';
import { ConfirmService } from '../../ui/confirm.service';
import { UpcomingPaymentService } from '../../services/upcoming-payment.service';
import { AccountSummary, refKey } from '../../models/account.model';
import {
  FREQUENCY_LABEL,
  RecurringPayment,
  monthlyEquivalent,
  occurrencesBetween,
  paidInMonth,
  planSummary,
  schedule,
  statusOf,
} from '../../models/recurring.model';
import { MatDialog } from '@angular/material/dialog';
import { PayBillComponent, PayBillResult } from '../../dialogs/pay-bill/pay-bill.component';
import { categoryIcon, inr } from '../../utils/analytics.util';
import { monthKey } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';
import { MetricCardComponent } from '../../ui/metric-card.component';
import { MoneyPipe } from '../../ui/money.pipe';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';

type Tab = 'upcoming' | 'today' | 'overdue' | 'paid' | 'completed' | 'all';

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, IconComponent, MetricCardComponent, MoneyPipe, SkeletonComponent, EmptyStateComponent, SelectComponent],
  templateUrl: './recurring.component.html',
  styleUrl: './recurring.component.scss',
})
export class RecurringComponent {
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);
  private confirm = inject(ConfirmService);
  private upcoming = inject(UpcomingPaymentService);
  quick = inject(QuickActionsService);
  private dialog = inject(MatDialog);

  readonly freqLabel = FREQUENCY_LABEL;
  readonly freqOptions: SelectOption[] = [
    { value: '', label: 'Any frequency' },
    ...(['once', 'weekly', 'monthly', 'quarterly', 'yearly', 'daily', 'custom'] as const).map(f => ({ value: f, label: (FREQUENCY_LABEL as any)[f] })),
  ];
  readonly sortOptions: SelectOption[] = [
    { value: 'due', label: 'By due date', icon: 'calendar-days' },
    { value: 'amount', label: 'By amount', icon: 'coins' },
    { value: 'name', label: 'By name', icon: 'list-checks' },
  ];
  readonly catIcon = categoryIcon;
  readonly today = new Date();
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'today', label: 'Due today' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'paid', label: 'Paid this month' },
    { id: 'completed', label: 'Completed' },
    { id: 'all', label: 'All' },
  ];

  private raw = toSignal(this.finance.recurring$);
  accountMap = toSignal(this.finance.accountMap$, { initialValue: new Map<string, AccountSummary>() });
  loading = computed(() => this.raw() === undefined);
  items = computed(() =>
    (this.raw() ?? [])
      .filter(p => !this.undo.hidden().has(p.id))
      .map(p => ({ p, s: statusOf(p, this.today), paid: paidInMonth(p, monthKey(this.today)) }))
  );

  tab = signal<Tab>('upcoming');
  q = signal('');
  sort = signal<'due' | 'amount' | 'name'>('due');
  freqFilter = signal('');
  selectedId = signal<string | null>(null);

  stats = computed(() => {
    const live = this.items().filter(x => !x.p.paused && !x.p.completed);
    // Every due date in the window counts (a weekly bill is due ~4 times in 30 days); overdue ones once.
    const in30 = new Date(this.today.getFullYear(), this.today.getMonth(), this.today.getDate() + 30);
    const occ30 = live.map(x => occurrencesBetween(x.p, this.today, in30, true).length * x.p.amount);
    const mStart = new Date(this.today.getFullYear(), this.today.getMonth(), 1);
    const mEnd = new Date(this.today.getFullYear(), this.today.getMonth() + 1, 0);
    const leftThisMonth = live.reduce((s, x) => s + occurrencesBetween(x.p, this.today, mEnd, true).length * x.p.amount, 0);
    return {
      active: live.length,
      due30: occ30.reduce((s, v) => s + v, 0),
      due30Count: live.reduce((s, x) => s + occurrencesBetween(x.p, this.today, in30, true).length, 0),
      leftThisMonth,
      monthStart: mStart,
      week: live.filter(x => x.s.days >= 0 && x.s.days <= 7).length,
      weekAmount: live.filter(x => x.s.days >= 0 && x.s.days <= 7).reduce((s, x) => s + x.p.amount, 0),
      overdue: live.filter(x => x.s.status === 'overdue').length,
      overdueAmount: live.filter(x => x.s.status === 'overdue').reduce((s, x) => s + x.p.amount, 0),
      paidCount: this.items().reduce((s, x) => s + x.paid.length, 0),
      paidAmount: this.items().reduce((s, x) => s + x.paid.reduce((a, h) => a + h.amount, 0), 0),
      monthly: live.reduce((s, x) => s + monthlyEquivalent(x.p), 0),
    };
  });

  counts = computed(() => ({
    upcoming: this.items().filter(x => !x.p.paused && (x.s.status === 'soon' || x.s.status === 'upcoming')).length,
    completed: this.items().filter(x => x.p.completed).length,
    today: this.items().filter(x => x.s.status === 'today').length,
    overdue: this.items().filter(x => x.s.status === 'overdue').length,
    paid: this.items().filter(x => x.paid.length).length,
    all: this.items().length,
  }));

  shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    const t = this.tab();
    const list = this.items().filter(x => {
      if (t === 'upcoming' && (x.p.paused || (x.s.status !== 'soon' && x.s.status !== 'upcoming'))) return false;
      if (t === 'today' && x.s.status !== 'today') return false;
      if (t === 'overdue' && x.s.status !== 'overdue') return false;
      if (t === 'paid' && !x.paid.length) return false;
      if (t === 'completed' && !x.p.completed) return false;
      if (this.freqFilter() && x.p.frequency !== this.freqFilter()) return false;
      if (q && ![x.p.description, x.p.category, this.accountName(x.p)].some(v => v.toLowerCase().includes(q))) return false;
      return true;
    });
    const s = this.sort();
    return list.sort((a, b) =>
      s === 'amount' ? b.p.amount - a.p.amount : s === 'name' ? a.p.description.localeCompare(b.p.description) : a.p.dueDate.getTime() - b.p.dueDate.getTime()
    );
  });

  selected = computed(() => this.items().find(x => x.p.id === this.selectedId()) ?? null);
  selectedSchedule = computed(() => (this.selected() ? schedule(this.selected()!.p, 6) : []));
  selectedPlan = computed(() => (this.selected() ? planSummary(this.selected()!.p, this.today) : null));

  emiPct(p: RecurringPayment): number {
    return p.installmentsTotal ? Math.min(100, Math.round((p.installmentsPaid / p.installmentsTotal) * 100)) : 0;
  }

  accountName(p: RecurringPayment): string {
    return p.account ? this.accountMap().get(refKey(p.account))?.name ?? 'Deleted account' : 'Not linked';
  }

  select(p: RecurringPayment): void {
    this.selectedId.set(this.selectedId() === p.id ? null : p.id);
  }

  /** Confirm amount / date / account first; the payment is then booked after 5 s (Undo cancels). */
  pay(p: RecurringPayment): void {
    this.dialog
      .open<PayBillComponent, { payment: RecurringPayment }, PayBillResult>(PayBillComponent, {
        data: { payment: p },
        width: 'min(96vw, 520px)',
        panelClass: 'ss-sheet-pane',
      })
      .afterClosed()
      .subscribe(r => {
        if (!r) return;
        const from = r.account ? this.accountMap().get(refKey(r.account))?.name : null;
        this.undo.defer(
          `Paid "${p.description}" · ${inr(r.amount)}${from ? ' from ' + from : ''}`,
          p.frequency === 'once' ? [p.id] : [],
          () => this.ledger.payRecurring(p, r.amount, r.date, r.account)
        );
      });
  }

  skip(p: RecurringPayment): void {
    this.undo.defer(`Skipped this cycle of "${p.description}"`, [], () => this.ledger.skipRecurring(p));
  }

  togglePause(p: RecurringPayment): void {
    this.ledger.setPaused(p, !p.paused).then(() => this.undo.offer(`${p.paused ? 'Resumed' : 'Paused'} "${p.description}"`, () => this.ledger.setPaused(p, p.paused)));
  }

  async remove(p: RecurringPayment): Promise<void> {
    const ok = await this.confirm.ask({ title: `Delete "${p.description}"?`, message: 'Payments you already recorded stay in your history.', confirm: 'Delete', danger: true });
    if (!ok) return;
    this.selectedId.set(null);
    this.undo.defer(`Deleted "${p.description}"`, [p.id], () => this.upcoming.delete(p.id));
  }
}
