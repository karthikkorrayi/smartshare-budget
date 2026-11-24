import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FinanceService } from '../../services/finance.service';
import { AccountRef, parseRef, refKey } from '../../models/account.model';
import { RecurringPayment, nextOccurrence } from '../../models/recurring.model';
import { checkDay, entryMoment, startOfDay, toDateInput, todayInput } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';
import { DateFieldComponent } from '../../ui/date-field.component';
import { MoneyPipe, PrivateMoneyPipe } from '../../ui/money.pipe';

export interface PayBillResult {
  amount: number;
  date: Date;
  account: AccountRef | null;
}

/**
 * Confirms a bill payment before it's booked: actual amount (pre-filled; asked for on variable bills),
 * the day it was paid and the account. Shows exactly what will happen — the expense, the account's
 * balance after it, and where the due date moves (or that the plan completes).
 */
@Component({
  standalone: true,
  imports: [FormsModule, DatePipe, IconComponent, SelectComponent, DateFieldComponent, MoneyPipe, PrivateMoneyPipe],
  template: `
    @let p = data.payment;
    <div class="dlg" role="dialog" aria-modal="true" [attr.aria-label]="'Pay ' + p.description">
      <div class="dlg-head">
        <span class="icon-tile lg pos"><app-icon name="circle-check" [size]="22" /></span>
        <div><h2>Mark “{{ p.description }}” paid</h2><p>Due {{ p.dueDate | date: 'EEE, d MMM y' }}{{ p.amountType === 'variable' ? ' · amount varies' : '' }}</p></div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>
      <div class="dlg-body">
        <div class="form-grid">
          <label class="field"><span>{{ p.amountType === 'variable' ? 'Actual amount this time' : 'Amount paid' }}</span>
            <span class="money-in"><i>₹</i><input type="number" min="0" step="0.01" inputmode="decimal" [ngModel]="amount()" (ngModelChange)="amount.set($event)" /></span>
            @if (diff(); as d) { <small [class.up]="d > 0">{{ d > 0 ? '+' : '−' }}{{ (d < 0 ? -d : d) | money: true }} vs the usual {{ p.amount | money }}</small> }</label>
          <div class="field"><span>Paid on</span>
            <app-date ariaLabel="Paid on" [max]="today" [quick]="['today', 'yesterday']" [ngModel]="dateInput()" (ngModelChange)="dateInput.set($event)" /></div>
          <div class="field span-2"><span>Paid from</span>
            <app-select ariaLabel="Paid from" [ngModel]="accountKey()" (ngModelChange)="accountKey.set($event)" [options]="accountOptions()" /></div>
        </div>

        <div class="outcome" aria-live="polite">
          <span class="k">What happens</span>
          <div class="o"><app-icon name="receipt" [size]="15" /><span>An expense of <b>{{ (amount() || 0) | money: true }}</b> in “{{ p.category }}”{{ account() ? ' from ' + account()!.name : ' (not linked to an account)' }}.</span></div>
          @if (account(); as a) {
            @if (a.type !== 'card') {
              <div class="o"><app-icon name="wallet" [size]="15" /><span>{{ a.name }}: {{ a.balance | privateMoney: a.key }} → {{ (a.balance - (amount() || 0)) | privateMoney: a.key }}</span></div>
            } @else {
              <div class="o"><app-icon name="credit-card" [size]="15" /><span>Added to {{ a.name }}'s unbilled spends.</span></div>
            }
          }
          <div class="o"><app-icon [name]="completes() ? 'trophy' : 'calendar-clock'" [size]="15" />
            <span>@if (p.frequency === 'once') { This one-time payment is then removed from your list. }
              @else if (completes()) { That's the last payment — the plan is marked <b>completed</b>. }
              @else { Next due date moves to <b>{{ next() | date: 'EEE, d MMM y' }}</b>@if (p.endType === 'count') { · payment {{ p.installmentsPaid + 1 }} of {{ p.installmentsTotal }}}. }</span></div>
        </div>
        @if (problems().length && touched()) {
          <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><ul>@for (e of problems(); track e) { <li>{{ e }}</li> }</ul></div>
        }
      </div>
      <div class="dlg-foot">
        <span class="spacer"></span>
        <button class="btn" (click)="ref.close()">Cancel</button>
        <button class="btn btn-primary" (click)="confirm()"><app-icon name="check" [size]="16" />Confirm payment</button>
      </div>
    </div>
  `,
  styles: [`
    .money-in { position: relative; display: flex; align-items: center;
      i { position: absolute; left: 12px; font-style: normal; color: var(--text-3); pointer-events: none; } input { padding-left: 28px !important; } }
    small.up { color: var(--warn) !important; }
    .outcome { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 14px; background: var(--surface-2);
      .k { font-size: 11px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
      .o { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; line-height: 1.45; app-icon { margin-top: 2px; color: var(--accent-strong); flex-shrink: 0; } } }
  `],
})
export class PayBillComponent {
  ref = inject(MatDialogRef<PayBillComponent, PayBillResult>);
  data = inject<{ payment: RecurringPayment }>(MAT_DIALOG_DATA);
  private finance = inject(FinanceService);

  readonly today = todayInput();
  private accounts = toSignal(this.finance.accounts$, { initialValue: [] });
  amount = signal<number | null>(this.data.payment.amount);
  dateInput = signal(toDateInput(new Date()));
  accountKey = signal(refKey(this.data.payment.account));
  touched = signal(false);

  account = computed(() => this.accounts().find(a => a.key === this.accountKey()) ?? null);
  accountOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Not linked to an account', icon: 'link' },
    ...this.accounts()
      .filter(a => a.status === 'Active' || a.key === this.accountKey())
      .map(a => ({ value: a.key, label: a.name, icon: a.icon, hint: a.subtitle })),
  ]);
  diff = computed(() => {
    const d = Math.round(((Number(this.amount()) || 0) - this.data.payment.amount) * 100) / 100;
    return d ? d : null;
  });
  next = computed(() => {
    const p = this.data.payment;
    return nextOccurrence(p.dueDate, p.frequency, p.intervalDays, p.anchorDay);
  });
  completes = computed(() => {
    const p = this.data.payment;
    if (p.frequency === 'once') return false;
    if (p.endType === 'count') return p.installmentsTotal > 0 && p.installmentsPaid + 1 >= p.installmentsTotal;
    if (p.endType === 'date' && p.endDate) return startOfDay(this.next()) > startOfDay(p.endDate);
    return false;
  });
  problems = computed(() => {
    const out: string[] = [];
    const a = Number(this.amount());
    if (!(a > 0)) out.push('Enter the amount paid.');
    if (a >= 1e9) out.push('That amount is too large.');
    const d = checkDay(this.dateInput(), { label: 'the payment date', notFuture: true });
    if (d) out.push(d);
    return out;
  });

  confirm(): void {
    this.touched.set(true);
    if (this.problems().length) return;
    this.ref.close({
      amount: Math.round(Number(this.amount()) * 100) / 100,
      date: entryMoment(this.dateInput()),
      account: parseRef(this.accountKey()),
    });
  }
}
