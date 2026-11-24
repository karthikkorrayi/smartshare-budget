import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { deleteField } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { UpcomingPaymentService } from '../../services/upcoming-payment.service';
import { UndoService } from '../../services/undo.service';
import { ConfirmService } from '../../ui/confirm.service';
import {
  AmountType,
  EndType,
  FREQUENCIES,
  FREQUENCY_LABEL,
  Frequency,
  RecurringPayment,
  describeChanges,
  planSummary,
} from '../../models/recurring.model';
import { BILL_CATEGORIES } from '../../models/review-item.model';
import { parseRef, refKey } from '../../models/account.model';
import { checkDay, dueMoment, fromDateInput, toDateInput, todayInput } from '../../utils/date-input.util';
import { categoryIcon } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';
import { DateFieldComponent } from '../../ui/date-field.component';
import { MoneyPipe } from '../../ui/money.pipe';

const CATS = [...BILL_CATEGORIES.filter(c => c !== 'Others'), 'Subscription', 'Utilities', 'Phone & Internet', 'Loan', 'Investment', 'Others'];
const FREQ_ICON: Record<Frequency, string> = {
  once: 'calendar-check', daily: 'sun', weekly: 'calendar-days', monthly: 'calendar', quarterly: 'layers', yearly: 'calendar-clock', custom: 'sliders-horizontal',
};

/**
 * Add / edit a bill or recurring payment.
 * The "How this plan works" panel recalculates on every change from the same functions the app uses
 * to pay and remind, so what it shows is what will happen. Editing an existing payment shows the
 * changes side by side and asks for confirmation before anything is saved; fields the form doesn't
 * touch (payment history, import link, installments paid…) are never overwritten.
 */
@Component({
  standalone: true,
  imports: [FormsModule, DatePipe, IconComponent, SelectComponent, DateFieldComponent, MoneyPipe],
  template: `
    <div class="dlg" role="dialog" aria-modal="true" [attr.aria-label]="existing() ? 'Edit payment' : 'New recurring payment'">
      <div class="dlg-head">
        <span class="icon-tile lg accent"><app-icon [name]="confirming() ? 'list-checks' : 'repeat'" [size]="22" /></span>
        <div>
          <h2>{{ confirming() ? 'Confirm changes' : existing() ? 'Edit payment' : 'New recurring payment' }}</h2>
          <p>{{ confirming() ? 'Check what changes before saving.' : 'Rent, EMIs, subscriptions, utility bills — anything you pay regularly.' }}</p>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>

      @if (loadingExisting()) {
        <div class="dlg-body"><span class="skeleton" style="height: 180px"></span></div>
      } @else if (confirming()) {
        <!-- ── Confirm an edit ─────────────────────────────── -->
        <div class="dlg-body">
          <div class="changes">
            @for (c of changes(); track c) { <div class="chg"><app-icon name="arrow-right" [size]="14" /><span>{{ c }}</span></div> }
          </div>
          <div class="calc">
            <span class="k">After saving</span>
            <b class="sentence">{{ plan()?.sentence }}</b>
            <div class="nums">
              @if (frequency() !== 'once') { <div><span>A month</span><b>{{ plan()!.monthly | money }}</b></div><div><span>A year</span><b>{{ plan()!.yearly | money }}</b></div> }
              @if (plan()!.remainingTotal !== null) { <div><span>Still to pay</span><b>{{ plan()!.remainingTotal | money }}</b></div> }
            </div>
          </div>
          <p class="muted tiny">Payments already recorded aren't changed{{ existing()!.history.length ? ' (' + existing()!.history.length + ' in history)' : '' }}.</p>
        </div>
        <div class="dlg-foot">
          <button class="btn" (click)="confirming.set(false)" [disabled]="saving()"><app-icon name="chevron-left" [size]="16" />Back</button>
          <span class="spacer"></span>
          <button class="btn btn-primary" (click)="commit()" [disabled]="saving()">
            @if (saving()) { <span class="spinner"></span> Saving… } @else { <app-icon name="check" [size]="16" />Confirm &amp; save }
          </button>
        </div>
      } @else {
        <!-- ── Form ─────────────────────────────────────────── -->
        <div class="dlg-body">
          <div class="form-grid">
            <label class="field span-2"><span>Name</span>
              <input type="text" maxlength="120" [ngModel]="description()" (ngModelChange)="description.set($event)" placeholder="e.g. Netflix, House rent, Car EMI" /></label>

            <div class="field span-2">
              <span id="amt-type">Amount</span>
              <div class="amt-row">
                <span class="money-in"><i>₹</i><input type="number" min="0" step="0.01" inputmode="decimal" [ngModel]="amount()" (ngModelChange)="amount.set($event)" placeholder="0" aria-labelledby="amt-type" /></span>
                <div class="seg" role="radiogroup" aria-label="Amount type">
                  <button type="button" role="radio" [attr.aria-checked]="amountType() === 'fixed'" [class.on]="amountType() === 'fixed'" (click)="amountType.set('fixed')"><app-icon name="lock" [size]="13" />Fixed</button>
                  <button type="button" role="radio" [attr.aria-checked]="amountType() === 'variable'" [class.on]="amountType() === 'variable'" (click)="amountType.set('variable')"><app-icon name="activity" [size]="13" />Varies</button>
                </div>
              </div>
              <small>{{ amountType() === 'variable' ? 'Enter a typical amount; you\\'ll confirm the actual bill each time you pay.' : 'The same amount every time.' }}</small>
            </div>

            <div class="field span-2">
              <span id="freq-l">Repeats</span>
              <div class="freq" role="radiogroup" aria-labelledby="freq-l">
                @for (f of freqs; track f) {
                  <button type="button" class="fq" role="radio" [attr.aria-checked]="frequency() === f" [class.on]="frequency() === f" (click)="frequency.set(f)">
                    <app-icon [name]="freqIcon[f]" [size]="15" /><span>{{ freqLabel[f] }}</span>
                  </button>
                }
              </div>
            </div>
            @if (frequency() === 'custom') {
              <label class="field"><span>Every (days)</span>
                <input type="number" min="1" max="366" step="1" inputmode="numeric" [ngModel]="intervalDays()" (ngModelChange)="intervalDays.set($event)" /></label>
            }

            <div class="field"><span>{{ existing() ? 'Next due date' : frequency() === 'once' ? 'Due date' : 'First due date' }}</span>
              <app-date ariaLabel="Due date" [quick]="['today', 'tomorrow', 'in7', 'monthEnd']" [invalid]="touched() && !!dueError()" [ngModel]="dueInput()" (ngModelChange)="dueInput.set($event)" />
              @if (dueIsPast() && !existing()) { <small class="warn-t"><app-icon name="alert-triangle" [size]="12" />In the past — it will show as overdue until you mark it paid.</small> }
            </div>
            <div class="field"><span>Category</span>
              <app-select ariaLabel="Category" [ngModel]="category()" (ngModelChange)="category.set($event)" [options]="categoryOptions()" /></div>

            @if (frequency() !== 'once') {
              <div class="field span-2">
                <span id="end-l">Ends</span>
                <div class="seg wide" role="radiogroup" aria-labelledby="end-l">
                  <button type="button" role="radio" [attr.aria-checked]="endType() === 'never'" [class.on]="endType() === 'never'" (click)="endType.set('never')">Never</button>
                  <button type="button" role="radio" [attr.aria-checked]="endType() === 'count'" [class.on]="endType() === 'count'" (click)="endType.set('count')">After N payments (EMI)</button>
                  <button type="button" role="radio" [attr.aria-checked]="endType() === 'date'" [class.on]="endType() === 'date'" (click)="endType.set('date')">On a date</button>
                </div>
              </div>
              @if (endType() === 'count') {
                <label class="field"><span>Total payments</span>
                  <input type="number" min="1" max="600" step="1" inputmode="numeric" [ngModel]="installmentsTotal()" (ngModelChange)="installmentsTotal.set($event)" placeholder="e.g. 24" /></label>
                <label class="field"><span>{{ existing() ? 'Paid so far' : 'Already paid before today' }}</span>
                  <input type="number" min="0" step="1" inputmode="numeric" [ngModel]="installmentsPaid()" (ngModelChange)="installmentsPaid.set($event)" placeholder="0" /></label>
              }
              @if (endType() === 'date') {
                <div class="field"><span>Last payment on or before</span>
                  <app-date ariaLabel="End date" [min]="dueInput() || null" [ngModel]="endInput()" (ngModelChange)="endInput.set($event)" /></div>
              }
            }

            <div class="field span-2"><span>Pay from <small>optional</small></span>
              <app-select ariaLabel="Pay from" [ngModel]="accountKey()" (ngModelChange)="accountKey.set($event)" [options]="accountOptions()" />
              <small>When you mark it paid, the expense is recorded against this account.</small></div>

            <div class="field span-2">
              <span id="rem-l">Reminders</span>
              <div class="rem-row">
                <div class="seg" role="radiogroup" aria-labelledby="rem-l">
                  @for (d of reminderSteps; track d) {
                    <button type="button" role="radio" [attr.aria-checked]="reminderDays() === d && notify()" [class.on]="reminderDays() === d && notify()" (click)="reminderDays.set(d); notify.set(true)">{{ d === 0 ? 'On the day' : d + 'd before' }}</button>
                  }
                  <button type="button" role="radio" [attr.aria-checked]="!notify()" [class.on]="!notify()" (click)="notify.set(false)"><app-icon name="bell-off" [size]="13" />Off</button>
                </div>
              </div>
              <small>{{ notify() ? 'Shows in the bell and the morning push from ' + (reminderDays() ? reminderDays() + ' day' + (reminderDays() === 1 ? '' : 's') + ' before' : 'the due date') + ' until it\\'s paid.' : 'No reminders for this payment.' }}</small>
            </div>

            <label class="toggle span-2"><input type="checkbox" [ngModel]="autopay()" (ngModelChange)="autopay.set($event)" />
              <span><b>Auto-debit</b><small>Your bank pays this automatically. You still mark it paid here so it's recorded.</small></span></label>
            @if (existing() && frequency() !== 'once') {
              <label class="toggle span-2"><input type="checkbox" [ngModel]="paused()" (ngModelChange)="paused.set($event)" />
                <span><b>Paused</b><small>Kept, but not due and no reminders until you resume.</small></span></label>
            }
            <label class="field span-2"><span>Notes <small>optional</small></span>
              <textarea maxlength="300" rows="2" [ngModel]="notes()" (ngModelChange)="notes.set($event)" placeholder="Account number, biller ID, anything useful"></textarea></label>
          </div>

          <!-- Live calculation -->
          @if (plan(); as pl) {
            <div class="calc" aria-live="polite">
              <span class="k"><app-icon name="sparkles" [size]="13" />How this plan works</span>
              <b class="sentence">{{ pl.sentence }}</b>
              <div class="nums">
                @if (frequency() !== 'once') {
                  <div><span>A month (avg)</span><b>{{ pl.monthly | money }}</b></div>
                  <div><span>A year</span><b>{{ pl.yearly | money }}</b></div>
                }
                <div><span>This month</span><b>{{ pl.thisMonth.total | money }}</b><small>{{ pl.thisMonth.count }} due</small></div>
                @if (pl.left !== null && frequency() !== 'once') {
                  <div><span>Remaining</span><b>{{ pl.remainingTotal | money }}</b><small>{{ pl.left }} payment{{ pl.left === 1 ? '' : 's' }}@if (pl.lastDate) { · last {{ pl.lastDate | date: 'MMM y' }} }</small></div>
                }
              </div>
              @if (endType() === 'count' && installmentsTotal() && frequency() !== 'once') {
                <div class="emi" [attr.aria-label]="(installmentsPaid() || 0) + ' of ' + installmentsTotal() + ' paid'">
                  <span class="bar"><i [style.width.%]="emiPct()"></i></span><small>{{ installmentsPaid() || 0 }} of {{ installmentsTotal() }} paid</small>
                </div>
              }
              @if (pl.next.length) {
                <div class="chips">@for (d of pl.next; track $index) { <span class="badge" [class.accent]="$index === 0">{{ d | date: 'EEE d MMM' }}</span> }</div>
              } @else {
                <p class="muted tiny">No payments left in this plan.</p>
              }
            </div>
          }

          @if (touched() && problems().length) {
            <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><ul>@for (e of problems(); track e) { <li>{{ e }}</li> }</ul></div>
          }
          @if (error()) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><span>{{ error() }}</span></div> }
        </div>

        <div class="dlg-foot">
          @if (existing()) { <button class="btn btn-ghost btn-danger-text" (click)="remove()" [disabled]="saving()"><app-icon name="trash2" [size]="16" />Delete</button> }
          <span class="spacer"></span>
          <button class="btn" (click)="ref.close()" [disabled]="saving()">Cancel</button>
          <button class="btn btn-primary" (click)="save()" [disabled]="saving()">
            @if (saving()) { <span class="spinner"></span> Saving… } @else { <app-icon name="check" [size]="16" />{{ existing() ? 'Review & save' : 'Add payment' }} }
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .money-in { position: relative; display: flex; align-items: center; flex: 1;
      i { position: absolute; left: 12px; font-style: normal; color: var(--text-3); pointer-events: none; }
      input { padding-left: 28px !important; width: 100%; } }
    .amt-row, .rem-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .seg.wide { display: flex; width: 100%; button { flex: 1; justify-content: center; white-space: normal; line-height: 1.2; padding: 4px 8px; min-height: 34px; } }
    .freq { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
    .fq { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border: 1px solid var(--border); border-radius: 12px;
      background: var(--surface); color: var(--text-2); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; text-align: center; line-height: 1.15;
      &:hover { border-color: var(--border-strong); }
      &.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); box-shadow: 0 0 0 1px var(--accent) inset; } }
    .warn-t { display: inline-flex; gap: 4px; align-items: center; color: var(--warn) !important; }
    .toggle { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer;
      input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--accent); flex-shrink: 0; }
      span { display: flex; flex-direction: column; gap: 2px; } b { font-size: 13.5px; } small { color: var(--text-3); font-size: 12px; } }
    .calc { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; background: var(--accent-soft);
      .k { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--accent-strong); }
      .sentence { font-size: 15px; color: var(--text); }
      .nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px;
        div { display: flex; flex-direction: column; gap: 1px; } span { font-size: 11.5px; color: var(--text-3); } b { font-size: 15px; color: var(--text); font-variant-numeric: tabular-nums; }
        small { font-size: 11.5px; color: var(--text-3); } }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; } }
    .emi { display: flex; align-items: center; gap: 8px; .bar { flex: 1; height: 6px; border-radius: 6px; background: color-mix(in srgb, var(--accent) 18%, transparent); overflow: hidden; }
      i { display: block; height: 100%; background: var(--accent); border-radius: 6px; transition: width .4s var(--ease); } small { font-size: 12px; color: var(--text-2); } }
    .changes { display: flex; flex-direction: column; gap: 6px; }
    .chg { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: var(--surface-2); font-size: 13.5px;
      app-icon { margin-top: 2px; color: var(--accent-strong); flex-shrink: 0; } }
    @media (max-width: 560px) { .freq { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  `],
})
export class RecurringFormComponent {
  ref = inject(MatDialogRef<RecurringFormComponent>);
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private upcoming = inject(UpcomingPaymentService);
  private undo = inject(UndoService);
  private confirm = inject(ConfirmService);
  private data = inject<{ id?: string | null }>(MAT_DIALOG_DATA) ?? {};

  readonly freqs = FREQUENCIES;
  readonly freqLabel = FREQUENCY_LABEL;
  readonly freqIcon = FREQ_ICON;
  readonly reminderSteps = [0, 1, 3, 7];
  readonly today = todayInput();
  accounts = toSignal(this.finance.accounts$, { initialValue: [] });
  existing = signal<RecurringPayment | null>(null);
  loadingExisting = signal(!!this.data.id);

  description = signal('');
  amount = signal<number | null>(null);
  amountType = signal<AmountType>('fixed');
  category = signal('Bills');
  frequency = signal<Frequency>('monthly');
  intervalDays = signal<number | null>(30);
  dueInput = signal(toDateInput(new Date()));
  endType = signal<EndType>('never');
  endInput = signal('');
  installmentsTotal = signal<number | null>(null);
  installmentsPaid = signal<number | null>(0);
  accountKey = signal('');
  reminderDays = signal(3);
  notify = signal(true);
  autopay = signal(false);
  paused = signal(false);
  notes = signal('');

  saving = signal(false);
  touched = signal(false);
  confirming = signal(false);
  error = signal('');

  categoryOptions = computed<SelectOption[]>(() =>
    (CATS.includes(this.category()) ? CATS : [...CATS, this.category()]).map(c => ({ value: c, label: c, icon: categoryIcon(c) }))
  );
  accountOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Not linked — just track it', icon: 'link' },
    ...this.accounts()
      .filter(a => a.status === 'Active' || a.key === this.accountKey())
      .map(a => ({ value: a.key, label: a.name, icon: a.icon, group: a.type === 'card' ? 'Credit cards' : a.type === 'wallet' ? 'Wallets' : 'Bank accounts' })),
  ]);

  dueError = computed(() => checkDay(this.dueInput(), { label: 'the due date', maxYears: 10 }));
  dueIsPast = computed(() => !this.dueError() && this.dueInput() < this.today);
  emiPct = computed(() => {
    const t = Number(this.installmentsTotal()) || 0;
    return t ? Math.min(100, ((Number(this.installmentsPaid()) || 0) / t) * 100) : 0;
  });

  /** The payment as it would be saved — used for the live calculation and the change list. */
  private draft = computed(() => {
    const due = fromDateInput(this.dueInput());
    if (!due) return null;
    const ex = this.existing();
    const freq = this.frequency();
    const anchor = ex && toDateInput(ex.dueDate) === this.dueInput() ? ex.anchorDay : due.getDate();
    const endType: EndType = freq === 'once' ? 'never' : this.endType();
    return {
      description: this.description().trim(),
      amount: Math.round((Number(this.amount()) || 0) * 100) / 100,
      amountType: this.amountType(),
      dueDate: dueMoment(due),
      frequency: freq,
      intervalDays: Math.max(1, Math.round(Number(this.intervalDays()) || 30)),
      anchorDay: anchor,
      endType,
      endDate: endType === 'date' ? (fromDateInput(this.endInput()) ? dueMoment(this.endInput()) : null) : null,
      installmentsTotal: endType === 'count' ? Math.max(0, Math.round(Number(this.installmentsTotal()) || 0)) : 0,
      installmentsPaid: endType === 'count' ? Math.max(0, Math.round(Number(this.installmentsPaid()) || 0)) : 0,
      account: parseRef(this.accountKey()),
    };
  });

  plan = computed(() => {
    const d = this.draft();
    return d && d.amount > 0 ? planSummary(d) : null;
  });

  changes = computed(() => {
    const ex = this.existing();
    const d = this.draft();
    return ex && d ? describeChanges(ex, d) : [];
  });

  problems = computed(() => {
    const out: string[] = [];
    if (!this.description().trim()) out.push('Give the payment a name.');
    const amt = Number(this.amount());
    if (!(amt > 0)) out.push('Enter an amount greater than 0.');
    if (amt >= 1e9) out.push('That amount is too large.');
    const dueP = this.dueError();
    if (dueP) out.push(dueP);
    const f = this.frequency();
    if (f === 'custom') {
      const n = Number(this.intervalDays());
      if (!(Number.isInteger(n) && n >= 1 && n <= 366)) out.push('Custom interval must be a whole number of days between 1 and 366.');
    }
    if (f !== 'once' && this.endType() === 'count') {
      const t = Number(this.installmentsTotal()), p = Number(this.installmentsPaid()) || 0;
      if (!(Number.isInteger(t) && t >= 1 && t <= 600)) out.push('Total payments must be a whole number between 1 and 600.');
      else if (!(Number.isInteger(p) && p >= 0 && p < t)) out.push(`Payments already made must be between 0 and ${t - 1}.`);
    }
    if (f !== 'once' && this.endType() === 'date') {
      const e = checkDay(this.endInput(), { label: 'the end date', min: this.dueInput() || undefined, maxYears: 40 });
      if (e) out.push(e);
    }
    const rd = Number(this.reminderDays());
    if (!(rd >= 0 && rd <= 30)) out.push('Reminder must be between 0 and 30 days.');
    return out;
  });

  constructor() {
    if (this.data.id) {
      firstValueFrom(this.finance.recurring$).then(list => {
        const p = list.find(x => x.id === this.data.id);
        this.loadingExisting.set(false);
        if (!p) {
          this.error.set('This payment no longer exists.');
          return;
        }
        this.existing.set(p);
        this.description.set(p.description);
        this.amount.set(p.amount);
        this.amountType.set(p.amountType);
        this.category.set(p.category);
        this.frequency.set(p.frequency);
        this.intervalDays.set(p.intervalDays);
        this.dueInput.set(toDateInput(p.dueDate));
        this.endType.set(p.endType);
        this.endInput.set(toDateInput(p.endDate));
        this.installmentsTotal.set(p.installmentsTotal || null);
        this.installmentsPaid.set(p.installmentsPaid);
        this.accountKey.set(refKey(p.account));
        this.reminderDays.set(p.reminderDays);
        this.notify.set(p.notify);
        this.autopay.set(p.autopay);
        this.paused.set(p.paused);
        this.notes.set(p.notes);
      });
    }
  }

  /** New payments save straight away; edits go through the confirmation screen when something important changed. */
  async save(): Promise<void> {
    this.touched.set(true);
    this.error.set('');
    if (this.problems().length) return;
    if (this.existing() && this.changes().length) {
      this.confirming.set(true);
      return;
    }
    await this.commit();
  }

  async commit(): Promise<void> {
    const d = this.draft();
    if (!d || this.problems().length) return;
    const doc: Record<string, unknown> = {
      description: d.description.slice(0, 120),
      amount: d.amount,
      amountType: d.amountType,
      category: this.category(),
      dueDate: d.dueDate,
      frequency: d.frequency,
      intervalDays: d.frequency === 'custom' ? d.intervalDays : null,
      anchorDay: d.anchorDay,
      endType: d.endType,
      endDate: d.endDate,
      installmentsTotal: d.endType === 'count' ? d.installmentsTotal : null,
      installmentsPaid: d.endType === 'count' ? d.installmentsPaid : null,
      accountType: d.account?.type ?? null,
      accountId: d.account?.id ?? null,
      reminderDays: Math.round(Number(this.reminderDays())),
      notify: this.notify(),
      autopay: this.autopay(),
      paused: this.frequency() !== 'once' && !!this.existing() && this.paused(),
      notes: this.notes().trim().slice(0, 300),
    };
    // Reopening a completed plan (e.g. more installments added) makes it due again.
    const ex = this.existing();
    if (ex?.completed && d.endType === 'count' && d.installmentsPaid < d.installmentsTotal) doc['completed'] = false;
    if (ex?.completed && d.endType === 'never') doc['completed'] = false;

    this.saving.set(true);
    try {
      const id = await this.ledger.saveRecurring(ex?.id ?? null, doc);
      if (ex) {
        // Undo puts back exactly what was there: previous values, and removes fields this edit added.
        const before = ex.raw;
        const restore: Record<string, unknown> = {};
        for (const k of [...Object.keys(doc), 'month', 'completed']) restore[k] = k in before ? before[k] : deleteField();
        this.undo.offer(`Updated "${doc['description']}"`, () => this.upcoming.update(ex.id, restore));
      } else {
        this.undo.offer(`Added "${doc['description']}"`, () => this.upcoming.delete(id));
      }
      this.ref.close(true);
    } catch (e) {
      console.error('[RecurringForm] save failed', e);
      this.confirming.set(false);
      this.error.set('Could not save. Check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    const ex = this.existing();
    if (!ex) return;
    const ok = await this.confirm.ask({ title: `Delete "${ex.description}"?`, message: 'Payments you already recorded stay in your history.', confirm: 'Delete', danger: true });
    if (!ok) return;
    this.ref.close(true);
    this.undo.defer(`Deleted "${ex.description}"`, [ex.id], () => this.upcoming.delete(ex.id));
  }
}
