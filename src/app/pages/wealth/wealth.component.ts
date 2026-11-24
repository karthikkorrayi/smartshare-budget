import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FinanceService } from '../../services/finance.service';
import { LoanService } from '../../services/loan.service';
import { LoanLedgerService } from '../../services/loan-ledger.service';
import { WealthService } from '../../services/wealth.service';
import { UndoService } from '../../services/undo.service';
import { QuickActionsService } from '../../core/quick-actions.service';
import { PrivacyService } from '../../core/privacy.service';
import { ConfirmService } from '../../ui/confirm.service';
import { LOAN_KINDS, Loan, loanStatus } from '../../models/loan.model';
import { cashHistory } from '../../utils/wealth.util';
import { inr, monthsIn } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { AmountComponent } from '../../ui/amount.component';
import { ChartComponent } from '../../ui/chart.component';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';

/** Every amount on this page sits behind one eye (like the dashboard). */
export const NET_WORTH_KEY = 'net-worth';

/**
 * Net worth — what you own minus what you owe, by category, with loans (EMIs) and how cash & bank
 * balances moved over the last 12 months.
 */
@Component({
  standalone: true,
  imports: [RouterLink, DecimalPipe, IconComponent, AmountComponent, ChartComponent, SkeletonComponent, EmptyStateComponent],
  templateUrl: './wealth.component.html',
  styleUrl: './wealth.component.scss',
})
export class WealthComponent {
  private finance = inject(FinanceService);
  private loansService = inject(LoanService);
  private loanLedger = inject(LoanLedgerService);
  private undo = inject(UndoService);
  private confirm = inject(ConfirmService);
  private privacy = inject(PrivacyService);
  quick = inject(QuickActionsService);

  readonly key = NET_WORTH_KEY;
  readonly today = new Date();
  nw = toSignal(inject(WealthService).netWorth$);
  private accounts = toSignal(this.finance.accounts$);
  private plans = toSignal(this.finance.recurring$, { initialValue: [] });
  private allLoans = toSignal(this.loansService.loans$);
  private months = monthsIn(new Date(this.today.getFullYear(), this.today.getMonth() - 11, 1), new Date(this.today.getFullYear(), this.today.getMonth() + 1, 1));
  private txns = toSignal(this.finance.window$(new Date(this.today.getFullYear(), this.today.getMonth() - 10, 1), new Date(this.today.getFullYear(), this.today.getMonth(), this.today.getDate() + 1)));

  shown = computed(() => this.privacy.isVisible(this.key));
  assets = computed(() => this.nw()?.groups.filter(g => g.side === 'asset') ?? []);
  liabilities = computed(() => this.nw()?.groups.filter(g => g.side === 'liability') ?? []);
  /** Composition bars: each group's share of the larger side. */
  scale = computed(() => Math.max(this.nw()?.assets ?? 0, this.nw()?.liabilities ?? 0, 1));

  loans = computed(() => {
    const hidden = this.undo.hidden();
    const plans = this.plans();
    return (this.allLoans() ?? [])
      .filter(l => !hidden.has(l.id))
      .map(l => {
        const plan = l.recurringId ? plans.find(p => p.id === l.recurringId) ?? null : null;
        return { loan: l, plan, s: loanStatus(l, plan), kind: LOAN_KINDS.find(k => k.id === l.kind)! };
      });
  });
  activeLoans = computed(() => this.loans().filter(x => x.loan.status === 'active'));
  closedLoans = computed(() => this.loans().filter(x => x.loan.status === 'closed'));
  monthlyEmi = computed(() => Math.round(this.activeLoans().reduce((s, x) => s + (x.s.nextDate ? x.loan.emi : 0), 0) * 100) / 100);

  history = computed(() => {
    const a = this.accounts();
    const t = this.txns();
    // 12 month-ends; the window starts where the oldest month ends, which is all the history needs.
    return a && t ? cashHistory(a, t, this.months, this.today) : null;
  });
  chartLabels = computed(() => (this.history() ?? []).map(h => new Date(+h.month.slice(0, 4), +h.month.slice(5) - 1, 1).toLocaleDateString('en-IN', { month: 'short' })));
  chartSeries = computed(() => [{ label: 'Cash & bank', data: (this.history() ?? []).map(h => h.amount), color: '--pos', kind: 'line' as const }]);
  change = computed(() => {
    const h = this.history();
    if (!h || h.length < 2) return null;
    return { amount: Math.round((h[h.length - 1].amount - h[0].amount) * 100) / 100, from: this.chartLabels()[0] };
  });

  path(link: string | null): string | null {
    return link ? link.split('#')[0] : null;
  }
  frag(link: string | null): string | undefined {
    return link?.includes('#') ? link.split('#')[1] : undefined;
  }

  /** A linked EMI payment knows the real next due date (it moves when you mark one paid). */
  nextDate(x: { plan: { dueDate: Date; completed: boolean } | null; s: { nextDate: Date | null } }): Date | null {
    return x.plan && !x.plan.completed ? x.plan.dueDate : x.s.nextDate;
  }

  toggleAmounts(): void {
    this.privacy.toggle(this.key);
  }
  pct(n: number): number {
    return Math.max(0, Math.min(100, (n / this.scale()) * 100));
  }
  money(n: number): string {
    return inr(n, true);
  }

  edit(l: Loan): void {
    this.quick.loan(l.id);
  }
  close(x: { loan: Loan; plan: any }): void {
    this.undo.defer(`Closed ${x.loan.name}`, [], () => this.loanLedger.close(x.loan, x.plan));
  }
  reopen(x: { loan: Loan; plan: any }): void {
    this.loanLedger.reopen(x.loan, x.plan);
  }
  async remove(x: { loan: Loan; plan: any }): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete ${x.loan.name}?`,
      message: x.plan
        ? `Its monthly EMI payment (“${x.plan.description}”) is removed too, so no more reminders. EMIs you've already marked paid stay in your expenses.`
        : 'Only the loan is removed. EMIs you’ve already recorded stay in your expenses.',
      confirm: 'Delete',
      danger: true,
    });
    if (ok) this.undo.defer(`Deleted ${x.loan.name}`, [x.loan.id], () => this.loanLedger.delete(x.loan, true));
  }
}
