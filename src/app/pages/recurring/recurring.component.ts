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
  paidInMonth,
  schedule,
  statusOf,
} from '../../models/recurring.model';
import { categoryIcon, inr } from '../../utils/analytics.util';
import { monthKey } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';
import { MetricCardComponent } from '../../ui/metric-card.component';
import { MoneyPipe } from '../../ui/money.pipe';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';

type Tab = 'upcoming' | 'today' | 'overdue' | 'paid' | 'all';

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, IconComponent, MetricCardComponent, MoneyPipe, SkeletonComponent, EmptyStateComponent],
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

  readonly freqLabel = FREQUENCY_LABEL;
  readonly catIcon = categoryIcon;
  readonly today = new Date();
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'today', label: 'Due today' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'paid', label: 'Paid this month' },
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
    const live = this.items().filter(x => !x.p.paused);
    const within30 = live.filter(x => x.s.days <= 30);
    return {
      active: live.length,
      due30: within30.reduce((s, x) => s + x.p.amount, 0),
      due30Count: within30.length,
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

  accountName(p: RecurringPayment): string {
    return p.account ? this.accountMap().get(refKey(p.account))?.name ?? 'Deleted account' : 'Not linked';
  }

  select(p: RecurringPayment): void {
    this.selectedId.set(this.selectedId() === p.id ? null : p.id);
  }

  pay(p: RecurringPayment): void {
    this.undo.defer(
      `Paid "${p.description}" · ${inr(p.amount)}${p.account ? ' from ' + this.accountName(p) : ''}`,
      p.frequency === 'once' ? [p.id] : [],
      () => this.ledger.payRecurring(p)
    );
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
