import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { UndoService } from '../../services/undo.service';
import { LendingRecord } from '../../models/lending.model';
import { parseRef, refKey } from '../../models/account.model';
import { checkDay, entryMoment, toDateInput } from '../../utils/date-input.util';
import { inr } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';
import { DateFieldComponent } from '../../ui/date-field.component';
import { PrivateMoneyPipe } from '../../ui/money.pipe';

/**
 * Record a repayment — all of it or part — for one lending record, with an option to forgive the rest.
 * Tracked money you lent: the payment is income ("Repayment") into the account it came into.
 * Untracked or borrowed: the ledger only. Saving is held for 5 s with Undo, like the rest of the app.
 */
@Component({
  standalone: true,
  imports: [FormsModule, IconComponent, SelectComponent, DateFieldComponent, PrivateMoneyPipe],
  styleUrls: ['../lending-form/lend-ui.scss'],
  template: `
    @let r = data.record;
    <div class="dlg" role="dialog" aria-modal="true" [attr.aria-label]="heading">
      <div class="dlg-head">
        <span class="icon-tile lg pos"><app-icon name="hand-coins" [size]="22" /></span>
        <div>
          <h2>{{ heading }}</h2>
          <p>{{ lent ? r.person + ' owes you' : 'You owe ' + r.person }} {{ inr(r.outstanding) }}@if (r.split) { · {{ r.split.title }} }</p>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>

      <div class="dlg-body">
        <div class="form-grid">
          <div class="field">
            <span>Amount {{ lent ? 'received' : 'paid' }}</span>
            <span class="money-in"><i>₹</i><input type="number" min="0" step="0.01" inputmode="decimal" [max]="r.outstanding" [ngModel]="amount()" (ngModelChange)="amount.set($event)"
              aria-label="Amount" [class.invalid]="touched() && !!amountError()" /></span>
            <div class="sugg">
              <button type="button" class="chip" [class.on]="Number(amount()) === r.outstanding" (click)="amount.set(r.outstanding)">All {{ inr(r.outstanding) }}</button>
              @if (r.outstanding >= 2) { <button type="button" class="chip" [class.on]="Number(amount()) === half" (click)="amount.set(half)">Half {{ inr(half) }}</button> }
            </div>
          </div>
          <div class="field">
            <span>{{ lent ? 'Received on' : 'Paid on' }}</span>
            <app-date ariaLabel="Date" [max]="today" [min]="minDate" [quick]="['today', 'yesterday']" [invalid]="touched() && !!dateError()" [ngModel]="dateInput()" (ngModelChange)="dateInput.set($event)" />
            @if (touched() && dateError(); as e) { <small class="field-err">{{ e }}</small> }
          </div>
          @if (counts) {
            <div class="field span-2">
              <span>Received into</span>
              <app-select ariaLabel="Received into" [ngModel]="accountKey()" (ngModelChange)="accountKey.set($event)" [options]="accountOptions()" />
            </div>
          }
          @if (lent && remaining() > 0) {
            <label class="toggle span-2" [class.on]="waive()"><input type="checkbox" [ngModel]="waive()" (ngModelChange)="waive.set($event)" />
              <span><b>Forgive the remaining {{ inr(remaining()) }}</b><small>Closes the record. Forgiven money is never counted as income.</small></span></label>
          }
        </div>

        <div class="calc" aria-live="polite">
          <span class="k"><app-icon name="sparkles" [size]="13" />What happens</span>
          @if (pay() > 0) {
            @if (counts) {
              <div class="o"><app-icon name="arrow-down-left" [size]="15" /><span><b>{{ inr(pay()) }}</b> is income (“Repayment”) {{ dateLabel() }}{{ account() ? ', into ' + account()!.name : '' }}.</span></div>
              @if (account()) {
                <div class="o"><app-icon name="wallet" [size]="15" /><span>{{ account()!.name }}: {{ account()!.balance | privateMoney: account()!.key }} → {{ (account()!.balance + pay()) | privateMoney: account()!.key }}</span></div>
              }
            } @else {
              <div class="o"><app-icon name="notebook-pen" [size]="15" /><span>{{ lent ? 'This loan wasn’t counted in your spending, so the repayment isn’t income either' : 'Repaying borrowed money isn’t spending' }} — only the ledger changes.</span></div>
            }
          }
          <div class="o"><app-icon name="circle-check" [size]="15" /><span>
            @if (closes()) { The record closes{{ waive() && remaining() > 0 ? ' — ' + inr(remaining()) + ' forgiven' : '' }}. }
            @else { Still to {{ lent ? 'receive' : 'pay' }}: <b>{{ inr(remaining()) }}</b>. }
          </span></div>
        </div>
        @if (touched() && amountError(); as e) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><span>{{ e }}</span></div> }
      </div>
      <div class="dlg-foot">
        <button class="btn" (click)="ref.close()">Cancel</button>
        <button class="btn btn-primary" (click)="save()"><app-icon name="check" [size]="16" />{{ closes() ? 'Settle' : 'Record payment' }}</button>
      </div>
    </div>
  `,
})
export class SettleLendingComponent {
  ref = inject(MatDialogRef<SettleLendingComponent>);
  data = inject<{ record: LendingRecord }>(MAT_DIALOG_DATA);
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);

  readonly Number = Number;
  readonly inr = (n: number) => inr(n, true);
  readonly today = toDateInput(new Date());
  readonly lent = this.data.record.direction === 'lent';
  /** Only tracked loans you gave turn repayments into income. */
  readonly counts = this.lent && this.data.record.trackInExpenses;
  readonly heading = this.lent ? 'Record repayment' : 'Record what you repaid';
  readonly half = Math.round((this.data.record.outstanding / 2) * 100) / 100;
  readonly minDate = this.data.record.date && toDateInput(this.data.record.date) <= this.today ? toDateInput(this.data.record.date) : null;

  private accounts = toSignal(this.finance.accounts$, { initialValue: [] });
  amount = signal<number | null>(this.data.record.outstanding);
  dateInput = signal(this.today);
  accountKey = signal(this.data.record.account && this.data.record.account.type !== 'card' ? refKey(this.data.record.account) : '');
  waive = signal(false);
  touched = signal(false);

  readonly account = computed(() => this.accounts().find(a => a.key === this.accountKey()) ?? null);
  readonly accountOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Not linked — income without an account', icon: 'link' },
    ...this.accounts()
      .filter(a => a.type !== 'card' && (a.status === 'Active' || a.key === this.accountKey()))
      .map(a => ({ value: a.key, label: a.name, icon: a.icon, group: a.type === 'bank' ? 'Bank accounts' : 'Wallets & cash' })),
  ]);
  readonly pay = computed(() => Math.min(this.data.record.outstanding, Math.max(0, Math.round((Number(this.amount()) || 0) * 100) / 100)));
  readonly remaining = computed(() => Math.max(0, Math.round((this.data.record.outstanding - this.pay()) * 100) / 100));
  readonly closes = computed(() => this.remaining() === 0 || this.waive());
  readonly dateLabel = computed(() => (this.dateInput() === this.today ? 'today' : 'on ' + new Date(this.dateInput() + 'T12:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })));
  readonly dateError = computed(() => checkDay(this.dateInput(), { label: 'the date', notFuture: true, min: this.minDate ?? undefined }));
  readonly amountError = computed(() => {
    const a = Number(this.amount()) || 0;
    if (a > this.data.record.outstanding + 0.004) return `That's more than the ${this.inr(this.data.record.outstanding)} outstanding.`;
    if (!(a > 0) && !this.waive()) return 'Enter the amount, or tick “Forgive” to close it without a payment.';
    return '';
  });

  save(): void {
    this.touched.set(true);
    if (this.amountError() || this.dateError()) return;
    const r = this.data.record;
    const pay = this.pay();
    const date = entryMoment(this.dateInput());
    const acc = this.counts ? parseRef(this.accountKey()) : null;
    const waive = this.lent && this.waive() && this.remaining() > 0;
    const closes = this.closes();
    const msg = pay > 0
      ? `${this.lent ? `${r.person} repaid` : `You repaid ${r.person}`} ${inr(pay, true)}${closes ? ' · settled' : ''}`
      : `Closed the record for ${r.person}`;
    this.ref.close(true);
    this.undo.defer(msg, closes ? [r.id] : [], () => this.ledger.settleLending(r, pay, acc, date, waive));
  }
}
