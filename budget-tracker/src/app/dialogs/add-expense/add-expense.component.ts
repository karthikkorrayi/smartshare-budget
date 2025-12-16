import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ExpenseService } from '../../services/expense.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2>{{ data?.expense ? 'Edit Expense' : 'Add Expense' }}</h2>

    <input placeholder="Description" [(ngModel)]="expense.description">
    <input type="number" placeholder="Amount" [(ngModel)]="expense.amount">

    <select [(ngModel)]="expense.category">
      <option *ngFor="let c of categories" [value]="c">
        {{ c }}
      </option>
    </select>

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

  constructor(
    private dialogRef: MatDialogRef<AddExpenseComponent>,
    private expenseService: ExpenseService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    if (data?.expense) {
      this.expense = { ...data.expense };
    }
  }

  save() {
    if (this.expense.id) {
      this.expenseService.updateExpense(this.expense);
    } else {
      this.expenseService.addExpense({
        ...this.expense,
        date: new Date(),
        month: this.data?.month
      });
    }
    this.dialogRef.close();
  }

  close() {
    this.dialogRef.close();
  }
}
