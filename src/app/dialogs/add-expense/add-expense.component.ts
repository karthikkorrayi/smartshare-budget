import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ExpenseService } from '../../services/expense.service';
import { UpcomingPaymentService } from '../../services/upcoming-payment.service';
import { fromDateInput, monthKey, toDateInput } from '../../utils/date-input.util';
import { toDate } from '../../utils/firestore.util';
import { UndoService } from '../../services/undo.service';

// 'Card Bill' = paying a credit-card bill. Not counted as spending (the card's purchases already are).
const CATEGORIES = ['Food', 'Shopping', 'Transport', 'Bills', 'Petrol', 'Tickets', 'Lent', 'Card Bill', 'Others'];
const CARD_BILL_HINT = /credit\s*card|card\s*(bill|payment|dues)|cc\s*(bill|payment)/i;

/**
 * Add / edit an expense, or schedule it as an upcoming payment.
 * Fixes: the expense now has a real date (it used to always be "now" even when added to another
 * month), its month follows that date, required fields are checked, and a failed save is shown
 * instead of silently closing the dialog.
 */
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['./add-expense.component.scss'],
  template: `
    <div class="form-container">
      <div class="form-header">
        <div class="header-content">
          <span class="header-icon">💸</span>
          <div>
            <h2 class="form-title">{{ expense.id ? 'Edit Expense' : 'Add Expense' }}</h2>
            <p class="form-subtitle">Track your spending</p>
          </div>
        </div>
      </div>

      <div class="form-content">
        <div class="input-group">
          <input type="text" id="description" [(ngModel)]="expense.description" (blur)="suggestCardBill()" class="floating-input" placeholder=" " maxlength="120">
          <label for="description" class="floating-label">Description</label>
        </div>

        <div class="form-row">
          <div class="input-group">
            <input type="number" id="amount" [(ngModel)]="expense.amount" class="floating-input" placeholder=" " min="0" step="0.01" inputmode="decimal">
            <label for="amount" class="floating-label">Amount (₹)</label>
          </div>

          <div class="input-group">
            <select id="category" [(ngModel)]="expense.category" class="floating-input floating-select">
              <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
            </select>
            <label for="category" class="floating-label">Category</label>
          </div>
        </div>

        <p class="field-hint" *ngIf="expense.category === 'Card Bill'">
          Card bill payments aren't counted as spending — the purchases on that card already are.
        </p>

        <div class="input-group" *ngIf="!isUpcoming">
          <input type="date" id="date" [(ngModel)]="dateInput" class="floating-input" placeholder=" " [max]="todayInput">
          <label for="date" class="floating-label">Date</label>
        </div>

        <div class="checkbox-section" *ngIf="!expense.id">
          <label class="checkbox-label">
            <input type="checkbox" [(ngModel)]="isUpcoming" class="checkbox-input">
            <span class="checkbox-text">Mark as upcoming payment</span>
          </label>
        </div>

        <div *ngIf="isUpcoming && !expense.id" class="input-group date-section">
          <input type="date" id="dueDate" [(ngModel)]="dueDate" class="floating-input" placeholder=" ">
          <label for="dueDate" class="floating-label">Due Date</label>
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
          <span class="btn-content">{{ saving() ? 'Saving…' : expense.id ? 'Update Expense' : isUpcoming ? 'Save Upcoming' : 'Save Expense' }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .field-hint { margin: -4px 0 0; padding: 8px 12px; border-radius: 10px; background: #f0f9ff; color: #075985; font-size: 13px; line-height: 1.45; }
    .form-errors { margin: 4px 0 0; padding: 10px 14px 10px 30px; border-radius: 12px; background: #fef2f2; color: #b91c1c; font-size: 14px; line-height: 1.5; }
  `],
})
export class AddExpenseComponent {
  categories = [...CATEGORIES];

  expense: any = { description: '', amount: null, category: 'Food' };

  isUpcoming = false;
  dueDate: string | null = null;
  dateInput: string;
  readonly todayInput = toDateInput(new Date());

  saving = signal(false);
  errors = signal<string[]>([]);

  constructor(
    private dialogRef: MatDialogRef<AddExpenseComponent>,
    private expenseService: ExpenseService,
    private upcomingService: UpcomingPaymentService,
    private undo: UndoService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    if (data?.expense) {
      this.expense = { ...data.expense };
      if (this.expense.category && !this.categories.includes(this.expense.category)) {
        this.categories.push(this.expense.category); // e.g. a category from an approved email
      }
    }
    this.dateInput = toDateInput(toDate(data?.expense?.date) ?? this.defaultDate(data?.month));
  }

  /** "HDFC credit card bill" → suggest the Card Bill category (only for new entries, never overrides a choice). */
  suggestCardBill(): void {
    if (!this.expense.id && this.expense.category === 'Food' && CARD_BILL_HINT.test(this.expense.description ?? '')) {
      this.expense.category = 'Card Bill';
    }
  }

  /** Today when adding to the current month; otherwise the 1st of the month being viewed. */
  private defaultDate(month?: string): Date {
    const now = new Date();
    if (!month || month === monthKey(now)) return now;
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1, 12);
  }

  private validate(): string[] {
    const out: string[] = [];
    if (!String(this.expense.description ?? '').trim()) out.push('Add a description.');
    if (!(Number(this.expense.amount) > 0)) out.push('Amount must be more than 0.');
    if (this.isUpcoming && !this.expense.id) {
      if (!fromDateInput(this.dueDate)) out.push('Pick the due date for this upcoming payment.');
    } else if (!fromDateInput(this.dateInput)) {
      out.push('Pick the date of the expense.');
    }
    return out;
  }

  async save() {
    const problems = this.validate();
    this.errors.set(problems);
    if (problems.length) return;

    const description = String(this.expense.description).trim();
    const amount = Math.round(Number(this.expense.amount) * 100) / 100;
    const category = this.expense.category || 'Others';

    this.saving.set(true);
    try {
      if (this.expense.id) {
        const date = this.withTime(fromDateInput(this.dateInput)!);
        const before = this.data.expense;
        await this.expenseService.updateExpense({
          id: this.expense.id,
          description,
          amount,
          category,
          date,
          month: monthKey(date),
          ...(this.expense.status ? { status: this.expense.status } : {}),
        });
        this.undo.offer(`Updated "${description}"`, () => this.expenseService.updateExpense({
          id: before.id, description: before.description, amount: before.amount, category: before.category, date: toDate(before.date) ?? date, month: before.month,
        }));
      } else if (this.isUpcoming) {
        const due = fromDateInput(this.dueDate)!;
        const ref = await this.upcomingService.add({
          description,
          amount,
          category,
          dueDate: new Date(due.getFullYear(), due.getMonth(), due.getDate(), 12),
          month: monthKey(due),
          createdAt: new Date(),
        });
        this.undo.offer(`Upcoming payment "${description}" added`, () => this.upcomingService.delete(ref.id));
      } else {
        const date = this.withTime(fromDateInput(this.dateInput)!);
        const ref = await this.expenseService.addExpense({ description, amount, category, date, month: monthKey(date) });
        this.undo.offer(`Added "${description}" · ₹${amount}`, () => this.expenseService.deleteExpense(ref.id));
      }
      this.dialogRef.close(true);
    } catch (err) {
      console.error('[AddExpense] save failed', err);
      this.errors.set(['Could not save. Check your connection and try again.']);
    } finally {
      this.saving.set(false);
    }
  }

  /** Keep the current time for today's entries (orders the list); midday for other days. */
  private withTime(day: Date): Date {
    const now = new Date();
    return monthKey(day) === monthKey(now) && day.getDate() === now.getDate()
      ? now
      : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
  }

  close() {
    this.dialogRef.close();
  }
}
