import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { UpcomingPaymentService } from '../../services/upcoming-payment.service';
import { UndoService } from '../../services/undo.service';
import { ConfirmService } from '../../ui/confirm.service';
import { FREQUENCIES, FREQUENCY_LABEL, Frequency, RecurringPayment, schedule } from '../../models/recurring.model';
import { BILL_CATEGORIES } from '../../models/review-item.model';
import { parseRef, refKey } from '../../models/account.model';
import { fromDateInput, toDateInput } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';

const CATS = [...BILL_CATEGORIES.filter(c => c !== 'Others'), 'Subscription', 'Utilities', 'Phone & Internet', 'Loan', 'Investment', 'Others'];

/** Add / edit a bill or recurring payment. */
@Component({
  standalone: true,
  imports: [FormsModule, DatePipe, IconComponent],
  template: `
    <div class="dlg" role="dialog" aria-modal="true" [attr.aria-label]="existing() ? 'Edit payment' : 'New recurring payment'">
      <div class="dlg-head">
        <span class="icon-tile lg accent"><app-icon name="repeat" [size]="22" /></span>
        <div>
          <h2>{{ existing() ? 'Edit payment' : 'New recurring payment' }}</h2>
          <p>Rent, EMIs, subscriptions, utility bills — anything you pay regularly.</p>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>

      <div class="dlg-body">
        <div class="form-grid">
          <label class="field span-2"><span>Name</span>
            <input type="text" maxlength="120" [(ngModel)]="description" placeholder="e.g. Netflix, House rent, Car EMI" /></label>
          <label class="field"><span>Amount (₹)</span>
            <input type="number" min="0" step="0.01" inputmode="decimal" [(ngModel)]="amount" placeholder="0" /></label>
          <label class="field"><span>Category</span>
            <select [(ngModel)]="category">@for (c of categories(); track c) { <option [value]="c">{{ c }}</option> }</select></label>
          <label class="field"><span>Repeats</span>
            <select [ngModel]="frequency()" (ngModelChange)="frequency.set($event)">@for (f of freqs; track f) { <option [value]="f">{{ freqLabel[f] }}</option> }</select></label>
          @if (frequency() === 'custom') {
            <label class="field"><span>Every (days)</span>
              <input type="number" min="1" max="366" [ngModel]="intervalDays()" (ngModelChange)="intervalDays.set($event)" /></label>
          }
          <label class="field"><span>{{ existing() ? 'Next due date' : 'First due date' }}</span>
            <input type="date" [ngModel]="dueInput()" (ngModelChange)="dueInput.set($event)" /></label>
          <label class="field span-2"><span>Pay from (optional)</span>
            <select [(ngModel)]="accountKey">
              <option value="">Not linked — just track it</option>
              @for (a of accounts(); track a.key) { <option [value]="a.key">{{ a.name }} · {{ a.type === 'card' ? 'Card' : a.type === 'wallet' ? 'Wallet' : 'Bank' }}</option> }
            </select>
            <small>When you mark it paid, the expense is recorded against this account.</small></label>
          <label class="field"><span>Remind me (days before)</span>
            <input type="number" min="0" max="30" [(ngModel)]="reminderDays" /></label>
          @if (existing()) {
            <label class="field check"><input type="checkbox" [(ngModel)]="paused" /><span>Paused</span></label>
          }
        </div>

        @if (preview().length > 1) {
          <div class="sched">
            <span class="muted tiny">Upcoming schedule</span>
            <div class="chips">@for (d of preview(); track $index) { <span class="badge" [class.accent]="$index === 0">{{ d | date: 'd MMM yy' }}</span> }</div>
          </div>
        }
        @if (error()) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><span>{{ error() }}</span></div> }
      </div>

      <div class="dlg-foot">
        @if (existing()) { <button class="btn btn-ghost btn-danger-text" (click)="remove()" [disabled]="saving()"><app-icon name="trash2" [size]="16" />Delete</button> }
        <span class="spacer"></span>
        <button class="btn" (click)="ref.close()" [disabled]="saving()">Cancel</button>
        <button class="btn btn-primary" (click)="save()" [disabled]="saving()">
          @if (saving()) { <span class="spinner"></span> Saving… } @else { {{ existing() ? 'Save changes' : 'Add payment' }} }
        </button>
      </div>
    </div>
  `,
  styles: [`
    .check { flex-direction: row !important; align-items: center; gap: 10px !important; align-self: end; min-height: 42px; span { font-weight: 500 !important; } }
    .sched { display: flex; flex-direction: column; gap: 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
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
  accounts = toSignal(this.finance.accounts$.pipe(), { initialValue: [] });
  existing = signal<RecurringPayment | null>(null);

  description = '';
  amount: number | null = null;
  category = 'Bills';
  frequency = signal<Frequency>('monthly');
  intervalDays = signal(30);
  dueInput = signal(toDateInput(new Date()));
  accountKey = '';
  reminderDays = 3;
  paused = false;
  saving = signal(false);
  error = signal('');

  categories = computed(() => (CATS.includes(this.category) ? CATS : [...CATS, this.category]));
  preview = computed(() => {
    const d = fromDateInput(this.dueInput());
    return d ? schedule({ dueDate: d, frequency: this.frequency(), intervalDays: Number(this.intervalDays()) || 30 }, 5) : [];
  });

  constructor() {
    if (this.data.id) {
      firstValueFrom(this.finance.recurring$).then(list => {
        const p = list.find(x => x.id === this.data.id);
        if (!p) return;
        this.existing.set(p);
        this.description = p.description;
        this.amount = p.amount;
        this.category = p.category;
        this.frequency.set(p.frequency);
        this.intervalDays.set(p.intervalDays);
        this.dueInput.set(toDateInput(p.dueDate));
        this.accountKey = refKey(p.account);
        this.reminderDays = p.reminderDays;
        this.paused = p.paused;
      });
    }
  }

  async save(): Promise<void> {
    const due = fromDateInput(this.dueInput());
    if (!this.description.trim()) return this.error.set('Give the payment a name.');
    if (!(Number(this.amount) > 0)) return this.error.set('Enter an amount greater than 0.');
    if (!due) return this.error.set('Pick the due date.');
    const rd = Math.round(Number(this.reminderDays));
    if (!(rd >= 0 && rd <= 30)) return this.error.set('Reminder must be between 0 and 30 days.');
    this.error.set('');
    const acc = parseRef(this.accountKey);
    const doc = {
      description: this.description.trim().slice(0, 120),
      amount: Math.round(Number(this.amount) * 100) / 100,
      category: this.category,
      dueDate: new Date(due.getFullYear(), due.getMonth(), due.getDate(), 12),
      frequency: this.frequency(),
      intervalDays: this.frequency() === 'custom' ? Math.max(1, Math.round(Number(this.intervalDays()) || 30)) : null,
      anchorDay: due.getDate(),
      accountType: acc?.type ?? null,
      accountId: acc?.id ?? null,
      reminderDays: rd,
      paused: !!this.paused,
    };
    this.saving.set(true);
    try {
      const ex = this.existing();
      const id = await this.ledger.saveRecurring(ex?.id ?? null, doc);
      if (ex) {
        const before = ex.raw;
        this.undo.offer(`Updated "${doc.description}"`, () => this.upcoming.update(ex.id, before));
      } else {
        this.undo.offer(`Added "${doc.description}"`, () => this.upcoming.delete(id));
      }
      this.ref.close(true);
    } catch (e) {
      console.error('[RecurringForm] save failed', e);
      this.error.set('Could not save. Check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    const ex = this.existing();
    if (!ex) return;
    const ok = await this.confirm.ask({ title: `Delete "${ex.description}"?`, message: 'Past payments you recorded stay in your history.', confirm: 'Delete', danger: true });
    if (!ok) return;
    this.ref.close(true);
    this.undo.defer(`Deleted "${ex.description}"`, [ex.id], () => this.upcoming.delete(ex.id));
  }
}
