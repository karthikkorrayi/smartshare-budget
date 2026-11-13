import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { map } from 'rxjs';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { UndoService } from '../../services/undo.service';
import { LendDirection } from '../../models/lending.model';
import { parseRef } from '../../models/account.model';
import { fromDateInput, toDateInput } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';

/** Record money you lent to someone or borrowed from someone. */
@Component({
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="dlg" role="dialog" aria-modal="true" aria-label="Lending or borrowing">
      <div class="dlg-head">
        <span class="icon-tile lg" [class.pos]="direction() === 'lent'" [class.warn]="direction() === 'borrowed'"><app-icon name="handshake" [size]="22" /></span>
        <div>
          <h2>{{ direction() === 'lent' ? 'Money you lent' : 'Money you borrowed' }}</h2>
          <p>Keep a clear record of who owes whom.</p>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>

      <div class="dlg-body">
        <div class="seg full" role="tablist">
          <button role="tab" [class.on]="direction() === 'lent'" [attr.aria-selected]="direction() === 'lent'" (click)="direction.set('lent')"><app-icon name="arrow-up-right" [size]="15" />I lent</button>
          <button role="tab" [class.on]="direction() === 'borrowed'" [attr.aria-selected]="direction() === 'borrowed'" (click)="direction.set('borrowed')"><app-icon name="arrow-down-left" [size]="15" />I borrowed</button>
        </div>
        <div class="form-grid">
          <label class="field span-2"><span>{{ direction() === 'lent' ? 'Lent to' : 'Borrowed from' }}</span>
            <input type="text" maxlength="60" [(ngModel)]="person" placeholder="Name" /></label>
          <label class="field"><span>Amount (₹)</span>
            <input type="number" min="0" step="0.01" inputmode="decimal" [(ngModel)]="amount" placeholder="0" /></label>
          <label class="field"><span>Date</span>
            <input type="date" [max]="today" [(ngModel)]="dateInput" /></label>
          <label class="field"><span>Expected repayment (optional)</span>
            <input type="date" [(ngModel)]="dueInput" /></label>
          @if (direction() === 'lent') {
            <label class="field"><span>Paid from (optional)</span>
              <select [(ngModel)]="accountKey">
                <option value="">Not linked</option>
                @for (a of banks(); track a.key) { <option [value]="a.key">{{ a.name }}</option> }
              </select></label>
            <label class="field span-2 check">
              <input type="checkbox" [(ngModel)]="track" />
              <span>Count in my spending now (as “Lent”), and as income when it's repaid</span>
            </label>
          } @else {
            <p class="span-2 muted tiny note"><app-icon name="info" [size]="14" /> Borrowed money isn't income and repaying it isn't spending, so this stays in your ledger only.</p>
          }
          <label class="field span-2"><span>Notes (optional)</span>
            <textarea rows="2" maxlength="300" [(ngModel)]="notes"></textarea></label>
        </div>
        @if (error()) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><span>{{ error() }}</span></div> }
      </div>
      <div class="dlg-foot">
        <button class="btn" (click)="ref.close()" [disabled]="saving()">Cancel</button>
        <button class="btn btn-primary" (click)="save()" [disabled]="saving()">@if (saving()) { <span class="spinner"></span> Saving… } @else { Save }</button>
      </div>
    </div>
  `,
  styles: [`
    .full { width: 100%; button { flex: 1; justify-content: center; } }
    .check { flex-direction: row !important; align-items: flex-start; gap: 10px !important; span { font-weight: 500 !important; } input { margin-top: 3px; } }
    .note { display: flex; gap: 6px; align-items: flex-start; margin: 0; }
  `],
})
export class LendingFormComponent {
  ref = inject(MatDialogRef<LendingFormComponent>);
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);
  private data = inject<{ direction?: LendDirection }>(MAT_DIALOG_DATA) ?? {};

  readonly today = toDateInput(new Date());
  banks = toSignal(this.finance.accounts$.pipe(map(a => a.filter(x => x.type === 'bank' && x.status === 'Active'))), { initialValue: [] });
  direction = signal<LendDirection>(this.data.direction ?? 'lent');
  person = '';
  amount: number | null = null;
  dateInput = this.today;
  dueInput = '';
  accountKey = '';
  track = true;
  notes = '';
  saving = signal(false);
  error = signal('');
  readonly isLent = computed(() => this.direction() === 'lent');

  async save(): Promise<void> {
    const date = fromDateInput(this.dateInput);
    const due = this.dueInput ? fromDateInput(this.dueInput) : null;
    if (!this.person.trim()) return this.error.set('Add the person’s name.');
    if (!(Number(this.amount) > 0)) return this.error.set('Enter an amount greater than 0.');
    if (!date) return this.error.set('Pick a valid date.');
    if (this.dueInput && !due) return this.error.set('The repayment date isn’t valid.');
    if (due && date && due < date) return this.error.set('Repayment date can’t be before the date it was given.');
    this.error.set('');
    this.saving.set(true);
    try {
      const now = new Date();
      const when = toDateInput(date) === toDateInput(now) ? now : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
      const s = await this.ledger.addLending({
        direction: this.direction(),
        person: this.person,
        amount: Number(this.amount),
        date: when,
        dueDate: due ? new Date(due.getFullYear(), due.getMonth(), due.getDate(), 12) : null,
        track: this.isLent() && this.track,
        account: this.isLent() ? parseRef(this.accountKey) : null,
        notes: this.notes,
      });
      this.undo.offer(`${this.isLent() ? 'Lent to' : 'Borrowed from'} ${this.person.trim()} recorded`, s.undo);
      this.ref.close(true);
    } catch (e) {
      console.error('[LendingForm] save failed', e);
      this.error.set('Could not save. Check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
