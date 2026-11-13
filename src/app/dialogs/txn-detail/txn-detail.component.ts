import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { UndoService } from '../../services/undo.service';
import { CardsService } from '../../services/cards.service';
import { WalletsService } from '../../services/wallets.service';
import { QuickActionsService } from '../../core/quick-actions.service';
import { ConfirmService } from '../../ui/confirm.service';
import { ACCOUNT_TYPE_LABEL, refKey } from '../../models/account.model';
import { FinanceTxn, categoryIcon, inr } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { MoneyPipe } from '../../ui/money.pipe';

const KIND_LABEL: Record<FinanceTxn['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  card: 'Card transaction',
  wallet: 'Wallet entry',
  transfer: 'Transfer',
};

/** Side drawer with everything known about one entry, plus Edit / Delete (respecting protected entries). */
@Component({
  standalone: true,
  imports: [DatePipe, IconComponent, MoneyPipe],
  template: `
    @let t = data.txn;
    <div class="dlg drawer" role="dialog" aria-modal="true" aria-label="Transaction details">
      <div class="dlg-head">
        <span class="icon-tile lg" [class.pos]="t.flow === 'in'" [class.neg]="t.flow === 'out'" [class.info]="t.flow === 'move'">
          <app-icon [name]="t.kind === 'transfer' ? 'arrow-left-right' : catIcon(t.category)" [size]="22" />
        </span>
        <div class="grow-min">
          <h2 class="truncate">{{ t.title }}</h2>
          <p>{{ kindLabel[t.kind] }} · {{ t.date | date: 'EEE, d MMM y' }}</p>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>

      <div class="dlg-body">
        <div class="hero" [class.in]="t.flow === 'in'" [class.move]="t.flow === 'move'">
          <span class="sign">{{ t.flow === 'in' ? '+' : t.flow === 'out' ? '−' : '' }}</span><span class="num">{{ t.amount | money: true }}</span>
          <span class="badge" [class.pos]="t.flow === 'in'" [class.neg]="t.flow === 'out'" [class.info]="t.flow === 'move'">
            {{ t.flow === 'in' ? (t.spend < 0 ? 'Refund' : 'Money in') : t.flow === 'out' ? 'Spending' : 'Not counted as spending' }}
          </span>
        </div>

        <dl class="kv">
          <dt>Category</dt><dd>{{ t.category }}</dd>
          <dt>{{ t.kind === 'transfer' ? 'From' : t.flow === 'in' ? 'Received into' : 'Paid from' }}</dt>
          <dd>{{ accountName(t.account) }}</dd>
          @if (t.kind === 'transfer') { <dt>To</dt><dd>{{ accountName(t.account2) }}</dd> }
          <dt>Date</dt><dd>{{ t.date | date: 'd MMM y, h:mm a' }}</dd>
          <dt>Recorded</dt><dd>{{ sourceLabel() }}</dd>
          @if (t.carryForward) { <dt>Note</dt><dd>Last month's leftover balance. Shown in this month's budget only — not counted again as income in multi-month totals.</dd> }
          @if (t.note && !t.carryForward) { <dt>Notes</dt><dd>{{ t.note }}</dd> }
          @if (t.raw?.recurringId) { <dt>From</dt><dd>Recurring payment</dd> }
          @if (t.raw?.editedAfterReview) { <dt>Edited</dt><dd>Corrected after email review</dd> }
        </dl>

        @if (!t.account && t.kind !== 'transfer') {
          <div class="alert"><app-icon name="info" [size]="16" /><span>Not linked to an account, so it doesn't change any balance. Edit it to choose the account it belongs to.</span></div>
        }
        @if (t.system) {
          <div class="alert warn"><app-icon name="lock" [size]="16" /><span>System-generated entries are protected and can't be edited or deleted.</span></div>
        }
      </div>

      @if (!t.system) {
        <div class="dlg-foot">
          <button class="btn btn-danger-text btn-ghost" (click)="remove()"><app-icon name="trash2" [size]="16" />Delete</button>
          <span class="spacer"></span>
          <button class="btn btn-primary" (click)="edit()"><app-icon name="pencil" [size]="16" />Edit</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .drawer { height: 100%; max-height: 100dvh; }
    .grow-min { min-width: 0; flex: 1; }
    .hero { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; padding: 18px; border-radius: var(--radius-lg); background: var(--surface-2); }
    .hero .num { font-size: 32px; font-weight: 750; letter-spacing: -.03em; }
    .hero .sign { font-size: 28px; font-weight: 600; color: var(--text-3); }
    .hero.in .num, .hero.in .sign { color: var(--pos); }
    .hero.move .num { color: var(--text-2); }
    .hero .badge { margin-left: auto; align-self: center; }
    @media (max-width: 640px) { .drawer { height: auto; } }
  `],
})
export class TxnDetailComponent {
  data = inject<{ txn: FinanceTxn }>(MAT_DIALOG_DATA);
  ref = inject(MatDialogRef<TxnDetailComponent>);
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);
  private quick = inject(QuickActionsService);
  private confirm = inject(ConfirmService);
  private dialog = inject(MatDialog);
  private cards = inject(CardsService);
  private wallets = inject(WalletsService);

  readonly kindLabel = KIND_LABEL;
  readonly catIcon = categoryIcon;
  private accounts = toSignal(this.finance.accountMap$);

  sourceLabel = computed(() => {
    const t = this.data.txn;
    if (t.carryForward) return 'Automatic carry-forward';
    if (t.system) return 'Automatically by the app';
    return t.source === 'email' ? 'From Gmail (approved in Review)' : t.source === 'demo' ? 'Sample data' : 'Added by you';
  });

  accountName(r: FinanceTxn['account']): string {
    if (!r) return 'Not linked to an account';
    const a = this.accounts()?.get(refKey(r));
    return a ? `${a.name} · ${ACCOUNT_TYPE_LABEL[a.type]}` : this.accounts() ? 'Deleted account' : '…';
  }

  async edit(): Promise<void> {
    const t = this.data.txn;
    this.ref.close();
    // Card credits (refunds / bill payments) and wallet top-ups / cashback keep their dedicated forms.
    if (t.kind === 'card' && t.raw?.direction === 'credit') {
      const { TransactionFormComponent } = await import('../transaction-form/transaction-form.component');
      const cards = await firstValueFrom(this.cards.cards$);
      this.dialog.open(TransactionFormComponent, { data: { cards, txn: t.raw }, width: 'min(96vw, 560px)' });
      return;
    }
    if (t.kind === 'wallet' && t.raw?.type !== 'spend') {
      const { WalletTxnFormComponent } = await import('../wallet-txn-form/wallet-txn-form.component');
      const wallets = await firstValueFrom(this.wallets.wallets$);
      this.dialog.open(WalletTxnFormComponent, { data: { wallets, txn: t.raw }, width: 'min(96vw, 520px)' });
      return;
    }
    this.quick.editTxn(t);
  }

  async remove(): Promise<void> {
    const t = this.data.txn;
    const ok = await this.confirm.ask({
      title: 'Delete this entry?',
      message: `"${t.title}" · ${inr(t.amount)} will be removed${t.account ? ' and the account balance updated' : ''}. You can undo for 5 seconds.`,
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.ref.close();
    this.undo.defer(`Deleted "${t.title}"`, [t.id], () => this.ledger.delete(t));
  }
}
