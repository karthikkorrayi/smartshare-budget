import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ExpenseService } from '../../services/expense.service';
import { UpcomingPaymentService } from '../../services/upcoming-payment.service';

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
        <div class="form-section">
          <label class="section-label">Description</label>
          <input
            type="text"
            placeholder="What did you spend on?"
            [(ngModel)]="expense.description"
            class="form-input">
        </div>

        <div class="form-row">
          <div class="form-section">
            <label class="section-label">Amount (₹)</label>
            <input
              type="number"
              placeholder="0.00"
              [(ngModel)]="expense.amount"
              class="form-input">
          </div>

          <div class="form-section">
            <label class="section-label">Category</label>
            <select [(ngModel)]="expense.category" class="form-select">
              <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
            </select>
          </div>
        </div>

        <div class="form-section checkbox-section">
          <label class="checkbox-label">
            <input type="checkbox" [(ngModel)]="isUpcoming">
            <span class="checkbox-text">Mark as upcoming payment</span>
          </label>
        </div>

        <div *ngIf="isUpcoming" class="form-section date-section">
          <label class="section-label">Due Date</label>
          <input
            type="date"
            [(ngModel)]="dueDate"
            class="form-input">
        </div>
      </div>

      <div class="form-actions">
        <button (click)="close()" class="btn btn-secondary">Cancel</button>
        <button (click)="save()" class="btn btn-primary">Save Expense</button>
      </div>
    </div>
  `
})
export class AddExpenseComponent {

  categories = ['Food', 'Shopping', 'Transport', 'Bills'];

  expense: any = {
    description: '',
    amount: 0,
    category: 'Food'
  };

  isUpcoming = false;
  dueDate: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<AddExpenseComponent>,
    private expenseService: ExpenseService,
    private upcomingService: UpcomingPaymentService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    if (data?.expense) {
      this.expense = {
        ...data.expense,
        dueDate: data.expense.dueDate
          ? data.expense.dueDate.toDate?.() || data.expense.dueDate
          : null
      };
    }
  }

  save() {
    // UPCOMING PAYMENT ONLY (NOTE)
    if (this.isUpcoming) {
      this.upcomingService.add({
        description: this.expense.description,
        amount: this.expense.amount,
        category: this.expense.category,
        dueDate: new Date(this.dueDate!),
        month: this.data.month,
        createdAt: new Date()
      });
    }
    // REAL EXPENSE
    else {
      this.expenseService.addExpense({
        description: this.expense.description,
        amount: this.expense.amount,
        category: this.expense.category,
        date: new Date(),
        month: this.data.month
      });
    }
    this.dialogRef.close();
  }

  close() {
    this.dialogRef.close();
  }
}