import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { map } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { LedgerService, canChangeAmount } from '../../services/ledger.service';
import { UndoService } from '../../services/undo.service';
import { LendDirection, LendingRecord, displayPhone, knownContacts, normalizePhone } from '../../models/lending.model';
import { parseRef } from '../../models/account.model';
import { checkDay, dueMoment, entryMoment, toDateInput } from '../../utils/date-input.util';
import { inr } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';
import { DateFieldComponent } from '../../ui/date-field.component';
import { PrivateMoneyPipe } from '../../ui/money.pipe';

/**
 * Record (or edit) money you lent to someone or borrowed from someone.
 * Lent + "count in my spending": a "Lent" entry on the account it left from (bank, wallet or card), and
 * each repayment is income. Borrowed: ledger only. Editing changes the name, number, amount (until the
 * first repayment), repay-by date and notes; where the money moved is fixed once recorded.
 */
@Component({
  standalone: true,
  imports: [FormsModule, IconComponent, SelectComponent, DateFieldComponent, PrivateMoneyPipe],
  styleUrls: ['./lend-ui.scss'],
  template: `
    <div class="dlg" role="dialog" aria-modal="true" [attr.aria-label]="heading()">
      <div class="dlg-head">
        <span class="icon-tile lg" [class.pos]="isLent()" [class.warn]="!isLent()"><app-icon name="handshake" [size]="22" /></span>
        <div>
          <h2>{{ heading() }}</h2>
          <p>{{ existing()?.split ? 'Share of “' + existing()!.split!.title + '”' : 'Keep a clear record of who owes whom.' }}</p>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>

      <div class="dlg-body">
        @if (loadingExisting()) {
          <span class="skeleton" style="height:220px;border-radius:14px"></span>
        } @else {
          @if (!existing()) {
            <div class="seg full" role="radiogroup" aria-label="Direction">
              <button type="button" role="radio" [class.on]="isLent()" [attr.aria-checked]="isLent()" (click)="direction.set('lent')"><app-icon name="arrow-up-right" [size]="15" />I lent</button>
              <button type="button" role="radio" [class.on]="!isLent()" [attr.aria-checked]="!isLent()" (click)="direction.set('borrowed')"><app-icon name="arrow-down-left" [size]="15" />I borrowed</button>
            </div>
          }
          <div class="form-grid">
            <div class="field span-2">
              <span>{{ isLent() ? 'Lent to' : 'Borrowed from' }}</span>
              <input type="text" maxlength="60" [ngModel]="person()" (ngModelChange)="person.set($event)" (blur)="fillPhone()" placeholder="Name" [class.invalid]="touched() && !person().trim()" />
              @if (!existing() && suggestions().length) {
                <div class="sugg">@for (c of suggestions(); track c.name) { <button type="button" class="chip" (click)="pick(c)">{{ c.name }}</button> }</div>
              }
            </div>
            <label class="field">
              <span>Phone <small class="muted">optional</small></span>
              <input type="tel" inputmode="tel" maxlength="18" [ngModel]="phone()" (ngModelChange)="phone.set($event)" placeholder="98765 43210" [class.invalid]="touched() && !!phoneError()" />
              <small>{{ phoneError() || 'For WhatsApp reminders and calls.' }}</small>
            </label>
            <div class="field">
              <span>Amount</span>
              <span class="money-in"><i>₹</i><input type="number" min="0" step="0.01" inputmode="decimal" [ngModel]="amount()" (ngModelChange)="amount.set($event)" placeholder="0"
                [disabled]="!!existing() && !amountEditable()" [class.invalid]="touched() && !(Number(amount()) > 0)" aria-label="Amount" /></span>
              @if (existing() && !amountEditable()) { <small>{{ existing()!.split ? 'Shares of a split are fixed.' : 'Fixed after the first repayment.' }}</small> }
            </div>
            <div class="field">
              <span>{{ isLent() ? 'Given on' : 'Received on' }}</span>
              @if (existing()) { <input type="text" [value]="dateText()" disabled /> }
              @else { <app-date ariaLabel="Date" [max]="today" [quick]="['today', 'yesterday']" [invalid]="touched() && !!dateError()" [ngModel]="dateInput()" (ngModelChange)="dateInput.set($event)" /> }
            </div>
            <div class="field">
              <span>Repay by <small class="muted">optional</small></span>
              <app-date ariaLabel="Repay by" [min]="dateInput() || null" [clearable]="true" [quick]="['in7', 'monthEnd']" [invalid]="touched() && !!dueError()"
                        [ngModel]="dueInput()" (ngModelChange)="dueInput.set($event || '')" />
              @if (touched() && dueError(); as e) { <small class="field-err">{{ e }}</small> }
            </div>

            @if (isLent() && !existing()) {
              <label class="toggle span-2" [class.on]="track()"><input type="checkbox" [ngModel]="track()" (ngModelChange)="track.set($event)" />
                <span><b>Count in my spending now</b><small>Booked as “Lent” on the account it left from; each repayment comes back as income. Off = just a note of who owes you.</small></span></label>
              @if (track()) {
                <div class="field span-2">
                  <span>Paid from</span>
                  <app-select ariaLabel="Paid from" [ngModel]="accountKey()" (ngModelChange)="accountKey.set($event)" [options]="accountOptions()" />
                </div>
              }
            } @else if (!isLent() && !existing()) {
              <p class="span-2 note"><app-icon name="info" [size]="14" /> Borrowed money isn't income and repaying it isn't spending, so this stays in your ledger only.</p>
            }
            <label class="field span-2"><span>Notes <small class="muted">optional</small></span>
              <textarea rows="2" maxlength="300" [ngModel]="notes()" (ngModelChange)="notes.set($event)" placeholder="What it was for"></textarea></label>
          </div>

          @if (!existing() && Number(amount()) > 0) {
            <div class="calc" aria-live="polite">
              <span class="k"><app-icon name="sparkles" [size]="13" />What happens</span>
              @if (isLent() && track()) {
                <div class="o"><app-icon name="arrow-up-right" [size]="15" /><span>A “Lent” entry of <b>{{ inr(Number(amount())) }}</b>{{ account() ? ' from ' + account()!.name : '' }} counts in this month's spending.</span></div>
                @if (account() && account()!.type !== 'card') {
                  <div class="o"><app-icon name="wallet" [size]="15" /><span>{{ account()!.name }}: {{ account()!.balance | privateMoney: account()!.key }} → {{ (account()!.balance - Number(amount())) | privateMoney: account()!.key }}</span></div>
                }
                <div class="o"><app-icon name="arrow-down-left" [size]="15" /><span>When {{ firstName() }} repays, it's recorded as income (“Repayment”) — partial payments are fine.</span></div>
              } @else if (isLent()) {
                <div class="o"><app-icon name="notebook-pen" [size]="15" /><span>Only noted: no balance or budget changes, now or when repaid.</span></div>
              } @else {
                <div class="o"><app-icon name="notebook-pen" [size]="15" /><span>You owe {{ firstName() }} <b>{{ inr(Number(amount())) }}</b>. It shows under “You owe” until you record repaying it.</span></div>
              }
            </div>
          }
          @if (touched() && problems().length) {
            <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><ul>@for (e of problems(); track e) { <li>{{ e }}</li> }</ul></div>
          }
          @if (error()) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><span>{{ error() }}</span></div> }
        }
      </div>
      <div class="dlg-foot">
        <button class="btn" (click)="ref.close()" [disabled]="saving()">Cancel</button>
        <button class="btn btn-primary" (click)="save()" [disabled]="saving() || loadingExisting()">
          @if (saving()) { <span class="spinner"></span> Saving… } @else { <app-icon name="check" [size]="16" />{{ existing() ? 'Save changes' : 'Save' }} }
        </button>
      </div>
    </div>
  `,
})
export class LendingFormComponent {
  ref = inject(MatDialogRef<LendingFormComponent>);
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);
  private data = inject<{ direction?: LendDirection; id?: string | null }>(MAT_DIALOG_DATA) ?? {};

  readonly Number = Number;
  readonly inr = (n: number) => inr(n, true);
  readonly today = toDateInput(new Date());
  private records = toSignal(this.finance.lending$);
  private accounts = toSignal(this.finance.accounts$, { initialValue: [] });

  existing = computed<LendingRecord | null>(() => (this.data.id ? this.records()?.find(r => r.id === this.data.id) ?? null : null));
  loadingExisting = computed(() => !!this.data.id && this.records() === undefined);

  direction = signal<LendDirection>(this.data.direction ?? 'lent');
  person = signal('');
  phone = signal('');
  amount = signal<number | null>(null);
  dateInput = signal(this.today);
  dueInput = signal('');
  accountKey = signal('');
  track = signal(true);
  notes = signal('');
  saving = signal(false);
  touched = signal(false);
  error = signal('');
  private filled = false;

  readonly isLent = computed(() => (this.existing()?.direction ?? this.direction()) === 'lent');
  readonly heading = computed(() => (this.existing() ? 'Edit record' : this.isLent() ? 'Money you lent' : 'Money you borrowed'));
  readonly amountEditable = computed(() => !this.existing() || canChangeAmount(this.existing()!));
  readonly firstName = computed(() => this.person().trim().split(/\s+/)[0] || 'they');
  readonly dateText = computed(() => this.existing()?.date?.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) ?? '—');
  readonly contacts = computed(() => knownContacts(this.records() ?? []));
  readonly suggestions = computed(() => {
    const q = this.person().trim().toLowerCase();
    return this.contacts().filter(c => (q ? c.name.toLowerCase().includes(q) && c.name.toLowerCase() !== q : true)).slice(0, 6);
  });
  readonly account = computed(() => this.accounts().find(a => a.key === this.accountKey()) ?? null);
  readonly accountOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Not linked — no balance changes', icon: 'link' },
    ...this.accounts()
      .filter(a => a.status === 'Active')
      .map(a => ({ value: a.key, label: a.name, icon: a.icon, group: a.type === 'bank' ? 'Bank accounts' : a.type === 'wallet' ? 'Wallets & cash' : 'Credit cards' })),
  ]);

  readonly phoneError = computed(() => (this.phone().trim() && !normalizePhone(this.phone()) ? 'Use 10 digits, or include the country code.' : ''));
  readonly dateError = computed(() => (this.existing() ? null : checkDay(this.dateInput(), { label: 'the date', notFuture: true })));
  readonly dueError = computed(() => (this.dueInput() ? checkDay(this.dueInput(), { label: 'the repay-by date', min: this.existing() ? undefined : this.dateInput() }) : null));
  readonly problems = computed(() => {
    const out: string[] = [];
    if (!this.person().trim()) out.push('Add the person’s name.');
    if (!(Number(this.amount()) > 0)) out.push('Enter an amount greater than 0.');
    if (Number(this.amount()) >= 1e9) out.push('That amount is too large.');
    const e = this.existing();
    if (e && Number(this.amount()) < e.settled + e.waived) out.push('The amount can’t be less than what’s already repaid.');
    for (const p of [this.phoneError(), this.dateError(), this.dueError()]) if (p) out.push(p);
    return out;
  });

  constructor() {
    // Fill the form once, when the record being edited has loaded.
    effect(() => {
      const e = this.existing();
      if (!e || this.filled) return;
      this.filled = true;
      untracked(() => {
        this.direction.set(e.direction);
        this.person.set(e.person);
        this.phone.set(e.phone ? displayPhone(e.phone) : '');
        this.amount.set(e.amount);
        this.dateInput.set(e.date ? toDateInput(e.date) : this.today);
        this.dueInput.set(e.dueDate ? toDateInput(e.dueDate) : '');
        this.notes.set(e.notes);
      });
    });
  }

  pick(c: { name: string; phone: string }): void {
    this.person.set(c.name);
    if (c.phone && !this.phone().trim()) this.phone.set(displayPhone(c.phone));
  }
  fillPhone(): void {
    if (this.phone().trim()) return;
    const c = this.contacts().find(x => x.name.toLowerCase() === this.person().trim().toLowerCase());
    if (c?.phone) this.phone.set(displayPhone(c.phone));
  }

  async save(): Promise<void> {
    this.touched.set(true);
    if (this.problems().length) return;
    this.error.set('');
    this.saving.set(true);
    try {
      const due = this.dueInput() ? dueMoment(this.dueInput()) : null;
      const e = this.existing();
      if (e) {
        const s = await this.ledger.updateLending(e, { person: this.person(), phone: this.phone(), amount: Number(this.amount()), dueDate: due, notes: this.notes() });
        this.undo.offer(`Updated the record for ${this.person().trim()}`, s.undo);
      } else {
        const s = await this.ledger.addLending({
          direction: this.direction(),
          person: this.person(),
          phone: this.phone(),
          amount: Number(this.amount()),
          date: entryMoment(this.dateInput()),
          dueDate: due,
          track: this.isLent() && this.track(),
          account: this.isLent() && this.track() ? parseRef(this.accountKey()) : null,
          notes: this.notes(),
        });
        this.undo.offer(`${this.isLent() ? 'Lent to' : 'Borrowed from'} ${this.person().trim()} · ${inr(Number(this.amount()))}`, s.undo);
      }
      this.ref.close(true);
    } catch (err: any) {
      console.error('[LendingForm] save failed', err);
      this.error.set(err?.message && !err?.code ? err.message : 'Could not save. Check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
