import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { IncomeService } from '../../services/income.service';
import { fromDateInput, monthKey, toDateInput } from '../../utils/date-input.util';
import { toDate } from '../../utils/firestore.util';
import { UndoService } from '../../services/undo.service';

/**
 * Add / edit income.
 * Fixes: a real date (was always "now"), month follows that date, required fields checked,
 * failed saves are shown, and editing no longer re-writes every field of the document.
 */
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['./add-income.component.scss'],
  template: `
    <div class="form-container">
      <div class="form-header">
        <div class="header-content">
          <span class="header-icon">💰</span>
          <div>
            <h2 class="form-title">{{ data?.income ? 'Edit Income' : 'Add Income' }}</h2>
            <p class="form-subtitle">Record your earnings</p>
          </div>
        </div>
      </div>

      <div class="form-content">
        <div class="input-group">
          <input type="text" id="source" [(ngModel)]="income.source" class="floating-input" placeholder=" " maxlength="120">
          <label for="source" class="floating-label">Income Source</label>
        </div>

        <div class="input-group">
          <input type="number" id="amount" [(ngModel)]="income.amount" class="floating-input" placeholder=" " min="0" step="0.01" inputmode="decimal">
          <label for="amount" class="floating-label">Amount (₹)</label>
        </div>

        <div class="input-group">
          <input type="date" id="date" [(ngModel)]="dateInput" class="floating-input" placeholder=" ">
          <label for="date" class="floating-label">Date received</label>
        </div>

        <ul class="form-errors" *ngIf="errors().length" role="alert">
          <li *ngFor="let e of errors()">{{ e }}</li>
        </ul>
      </div>

      <div class="form-actions">
        <button (click)="close()" class="btn btn-cancel" [disabled]="saving()">
          <span class="btn-content">Cancel</span>
        </button>
        <button (click)="save()" class="btn btn-save" [disabled]="saving()">
          <span class="btn-content">{{ saving() ? 'Saving…' : data?.income ? 'Update Income' : 'Save Income' }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .form-errors { margin: 4px 0 0; padding: 10px 14px 10px 30px; border-radius: 12px; background: #fef2f2; color: #b91c1c; font-size: 14px; line-height: 1.5; }
  `],
})
export class AddIncomeComponent {
  income: any = { source: '', amount: null };
  dateInput: string;
  saving = signal(false);
  errors = signal<string[]>([]);

  constructor(
    private dialogRef: MatDialogRef<AddIncomeComponent>,
    private incomeService: IncomeService,
    private undo: UndoService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    if (data?.income) this.income = { ...data.income };
    this.dateInput = toDateInput(toDate(data?.income?.date) ?? this.defaultDate(data?.month));
  }

  private defaultDate(month?: string): Date {
    const now = new Date();
    if (!month || month === monthKey(now)) return now;
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1, 12);
  }

  async save() {
    const out: string[] = [];
    if (!String(this.income.source ?? '').trim()) out.push('Add where the money came from.');
    if (!(Number(this.income.amount) > 0)) out.push('Amount must be more than 0.');
    const day = fromDateInput(this.dateInput);
    if (!day) out.push('Pick the date you received it.');
    this.errors.set(out);
    if (out.length) return;

    const now = new Date();
    const date = toDateInput(day!) === toDateInput(now) ? now : new Date(day!.getFullYear(), day!.getMonth(), day!.getDate(), 12);
    const fields = {
      source: String(this.income.source).trim(),
      amount: Math.round(Number(this.income.amount) * 100) / 100,
      date,
      month: monthKey(date),
    };

    this.saving.set(true);
    try {
      if (this.income.id) {
        const b = this.data.income;
        await this.incomeService.updateIncome({ id: this.income.id, ...fields });
        this.undo.offer(`Updated income "${fields.source}"`, () =>
          this.incomeService.updateIncome({ id: b.id, source: b.source, amount: b.amount, date: toDate(b.date) ?? date, month: b.month }));
      } else {
        const ref = await this.incomeService.addIncome(fields);
        this.undo.offer(`Added income "${fields.source}" · ₹${fields.amount}`, () => this.incomeService.deleteIncome(ref.id));
      }
      this.dialogRef.close(true);
    } catch (err) {
      console.error('[AddIncome] save failed', err);
      this.errors.set(['Could not save. Check your connection and try again.']);
    } finally {
      this.saving.set(false);
    }
  }

  close() {
    this.dialogRef.close();
  }
}
