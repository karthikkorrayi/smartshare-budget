import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatInputModule } from "@angular/material/input";
import { ExpenseService } from "../../services/expense.service";
import { getCurrentMonth } from "../../utils/date.util";

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatInputModule, MatButtonModule],
  template: `
    <h2>Add Expense</h2>

    <input matInput placeholder="Description" [(ngModel)]="description">
    <input matInput type="number" placeholder="Amount" [(ngModel)]="amount">

    <button mat-raised-button color="warn" (click)="save()">Add</button>
  `
})
export class ExpensesComponent {
  description = '';
  amount = 0;

  constructor(private expenseService: ExpenseService) {}

  save() {
    this.expenseService.addExpense({
      description: this.description,
      amount: this.amount,
      date: new Date(),
      month: getCurrentMonth()
    });

    this.description = '';
    this.amount = 0;
  }
}
