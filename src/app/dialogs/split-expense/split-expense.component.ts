import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { map } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { UndoService } from '../../services/undo.service';
import { knownContacts } from '../../models/lending.model';
import { refKey } from '../../models/account.model';
import { FinanceTxn, inr } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { MoneyPipe } from '../../ui/money.pipe';
import { SplitEditorComponent } from '../../components/split-editor/split-editor.component';

/** "Split this amount" for an expense that's already recorded (opened from its details). */
@Component({
  standalone: true,
  imports: [DatePipe, IconComponent, MoneyPipe, SplitEditorComponent],
  template: `
    @let t = data.txn;
    <div class="dlg" role="dialog" aria-modal="true" aria-label="Split this amount">
      <div class="dlg-head">
        <span class="icon-tile lg accent"><app-icon name="split" [size]="22" /></span>
        <div>
          <h2>Split “{{ t.title }}”</h2>
          <p>{{ t.amount | money: true }} · {{ t.date | date: 'd MMM y' }}{{ accountName() ? ' · ' + accountName() : '' }}</p>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>
      <div class="dlg-body">
        <app-split-editor [total]="t.amount" [contacts]="contacts()" [category]="t.category" [accountName]="accountName()" [touched]="touched()" />
        @if (error()) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><span>{{ error() }}</span></div> }
      </div>
      <div class="dlg-foot">
        <button class="btn" (click)="ref.close()" [disabled]="saving()">Cancel</button>
        <button class="btn btn-primary" (click)="save()" [disabled]="saving()">
          @if (saving()) { <span class="spinner"></span> Saving… } @else { <app-icon name="check" [size]="16" />Save split }
        </button>
      </div>
    </div>
  `,
})
export class SplitExpenseComponent {
  ref = inject(MatDialogRef<SplitExpenseComponent>);
  data = inject<{ txn: FinanceTxn }>(MAT_DIALOG_DATA);
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);
  private editor = viewChild.required(SplitEditorComponent);

  private accounts = toSignal(this.finance.accountMap$);
  contacts = toSignal(this.finance.lending$.pipe(map(list => knownContacts(list))), { initialValue: [] });
  accountName = computed(() => (this.data.txn.account ? this.accounts()?.get(refKey(this.data.txn.account))?.name ?? '' : ''));
  touched = signal(false);
  saving = signal(false);
  error = signal('');

  async save(): Promise<void> {
    this.touched.set(true);
    if (this.editor().problems().length) return;
    const t = this.data.txn;
    const v = this.editor().value();
    this.saving.set(true);
    this.error.set('');
    try {
      const s = await this.ledger.recordSplit(
        t.account,
        { description: t.title, amount: t.amount, category: t.category, date: t.date, notes: t.raw?.notes ?? '' },
        v,
        t
      );
      this.undo.offer(`Split "${t.title}" · ${inr(t.amount)} with ${v.people.length} ${v.people.length === 1 ? 'person' : 'people'}`, s.undo);
      this.ref.close(true);
    } catch (e: any) {
      console.error('[SplitExpense] failed', e);
      this.error.set(e?.message && !e?.code ? e.message : 'Could not save. Check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
