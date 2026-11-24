import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanceService } from '../../services/finance.service';
import { LedgerService, removesLentEntry } from '../../services/ledger.service';
import { UndoService } from '../../services/undo.service';
import { QuickActionsService } from '../../core/quick-actions.service';
import { ConfirmService } from '../../ui/confirm.service';
import {
  LendingRecord,
  PersonSummary,
  SplitGroup,
  callLink,
  displayPhone,
  lendingDue,
  lendingStats,
  peopleFrom,
  reminderText,
  splitsFrom,
  whatsappLink,
} from '../../models/lending.model';
import { inr } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { MetricCardComponent } from '../../ui/metric-card.component';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { MoneyPipe } from '../../ui/money.pipe';

type Tab = 'people' | 'open' | 'splits' | 'settled';

/**
 * Lending & splits — everyone who owes you or whom you owe, the money behind it, and how it shows in
 * your budget. Repayments, reminders (WhatsApp / call), edits and deletes all happen here.
 */
@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, IconComponent, MetricCardComponent, SkeletonComponent, EmptyStateComponent, MoneyPipe],
  templateUrl: './lending.component.html',
  styleUrl: './lending.component.scss',
})
export class LendingComponent {
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);
  private confirm = inject(ConfirmService);
  quick = inject(QuickActionsService);

  readonly due = lendingDue;
  readonly phone = displayPhone;
  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'people', label: 'People', icon: 'users' },
    { id: 'open', label: 'Open', icon: 'hand-coins' },
    { id: 'splits', label: 'Splits', icon: 'split' },
    { id: 'settled', label: 'Settled', icon: 'circle-check' },
  ];

  private all = toSignal(this.finance.lending$);
  loading = computed(() => this.all() === undefined);
  /** Records hidden while a delete / settle is held for Undo drop out of every view. */
  records = computed(() => {
    const hidden = this.undo.hidden();
    return (this.all() ?? []).filter(r => !hidden.has(r.id));
  });
  tab = signal<Tab>('people');
  q = signal('');
  expanded = signal<string | null>(null);

  stats = computed(() => lendingStats(this.records()));
  people = computed(() => this.match(peopleFrom(this.records()), p => p.name + ' ' + p.phone));
  open = computed(() =>
    this.match(
      this.records()
        .filter(r => r.status === 'PENDING')
        .sort((a, b) => dueRank(a) - dueRank(b) || (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)),
      r => r.person + ' ' + (r.split?.title ?? '') + ' ' + r.notes
    )
  );
  splits = computed(() => this.match(splitsFrom(this.records()), g => g.title + ' ' + g.members.map(m => m.person).join(' ')));
  settled = computed(() =>
    this.match(
      this.records()
        .filter(r => r.status === 'PAID')
        .sort((a, b) => (b.paidDate?.getTime() ?? 0) - (a.paidDate?.getTime() ?? 0)),
      r => r.person + ' ' + (r.split?.title ?? '')
    ).slice(0, 60)
  );
  counts = computed<Record<Tab, number>>(() => ({
    people: this.people().filter(p => p.open.length).length,
    open: this.open().length,
    splits: this.splits().filter(g => !g.done).length,
    settled: 0,
  }));
  budgetNet = computed(() => Math.round((this.stats().lentSpendThisMonth - this.stats().repaymentIncomeThisMonth) * 100) / 100);

  private match<T>(list: T[], text: (x: T) => string): T[] {
    const q = this.q().trim().toLowerCase();
    return q ? list.filter(x => text(x).toLowerCase().includes(q)) : list;
  }

  // ── Contact ────────────────────────────────────────────────────
  wa(records: LendingRecord[], phone: string): string {
    return whatsappLink(phone, reminderText(records));
  }
  call(phone: string): string {
    return callLink(phone);
  }
  canRemind(records: LendingRecord[]): boolean {
    return records.some(r => r.status === 'PENDING' && r.outstanding > 0);
  }
  initials(name: string): string {
    const p = name.trim().split(/\s+/).filter(Boolean);
    return p.length ? (p[0][0] + (p[1]?.[0] ?? '')).toUpperCase() : '?';
  }
  toggle(key: string): void {
    this.expanded.update(k => (k === key ? null : key));
  }
  pct(r: LendingRecord): number {
    return r.amount ? Math.min(100, ((r.settled + r.waived) / r.amount) * 100) : 0;
  }
  memberState(r: LendingRecord): 'paid' | 'part' | 'open' {
    return r.status === 'PAID' ? 'paid' : r.settled > 0 ? 'part' : 'open';
  }
  splitPct(g: SplitGroup): number {
    return g.owed ? Math.min(100, ((g.owed - g.outstanding) / g.owed) * 100) : 0;
  }
  netLabel(p: PersonSummary): string {
    if (!p.open.length) return 'All settled';
    if (p.net > 0) return `Owes you ${inr(p.net, true)}`;
    if (p.net < 0) return `You owe ${inr(-p.net, true)}`;
    return 'Even';
  }

  // ── Actions ────────────────────────────────────────────────────
  settle(r: LendingRecord): void {
    this.quick.settle(r);
  }
  edit(r: LendingRecord): void {
    this.quick.lending(r.direction, r.id);
  }
  splitBill(): void {
    this.quick.addTxn('expense', null, { split: true });
  }

  async remove(r: LendingRecord): Promise<void> {
    const message = removesLentEntry(r)
      ? `Its ${inr(r.amount, true)} “Lent” entry is removed too, as if the loan never happened.`
      : r.settled > 0 && r.trackInExpenses
        ? `Only the record is removed. The “Lent” spending and the ${inr(r.settled, true)} already received both stay, because they happened.`
        : 'Only the record is removed — no balances change.';
    const ok = await this.confirm.ask({ title: `Delete the record for ${r.person}?`, message, confirm: 'Delete', danger: true });
    if (ok) this.undo.defer(`Deleted record for ${r.person}`, [r.id], () => this.ledger.deleteLending(r));
  }

  async removeSplit(g: SplitGroup): Promise<void> {
    if (g.collected > 0) return;
    const ok = await this.confirm.ask({
      title: `Delete the split “${g.title}”?`,
      message: `Removes every person's record and “Lent” entry${g.ownShare > 0 ? ', and your own ' + inr(g.ownShare, true) + ' share' : ''} — the account gets the full ${inr(g.total, true)} back.`,
      confirm: 'Delete split',
      danger: true,
    });
    if (ok) this.undo.defer(`Deleted split “${g.title}”`, g.members.map(m => m.id), () => this.ledger.deleteSplit(g.members));
  }
}

/** Overdue first, then by repay-by date, then those without one. */
function dueRank(r: LendingRecord): number {
  return r.dueDate ? r.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
}
