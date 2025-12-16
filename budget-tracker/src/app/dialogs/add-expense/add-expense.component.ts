import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ExpenseService } from '../../services/expense.service';
import { UpcomingPaymentService } from '../../services/upcoming-payment.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2>{{ expense.id ? 'Edit Expense' : 'Add Expense' }}</h2>

    <input placeholder="Description" [(ngModel)]="expense.description">
    <input type="number" placeholder="Amount" [(ngModel)]="expense.amount">

    <select [(ngModel)]="expense.category">
      <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
    </select>

    <label>
      <input type="checkbox" [(ngModel)]="isUpcoming">
      Add as Upcoming Payment
    </label>

    <div *ngIf="isUpcoming">
      <label>Due Date</label>
      <input type="date" [(ngModel)]="dueDate">
    </div>

    <div class="actions">
      <button (click)="save()">Save</button>
      <button (click)="close()">Cancel</button>
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
