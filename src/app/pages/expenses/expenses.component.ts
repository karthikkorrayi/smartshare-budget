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
  templateUrl: './expenses.component.html',
  styleUrl: './expenses.component.scss',
})
export class ExpensesComponent {
  description = '';
  amount = 0;
  category = 'Food';
  categories = ['Food', 'Shopping', 'Transport', 'Bills'];


  constructor(private expenseService: ExpenseService) {}

  save() {
    this.expenseService.addExpense({
      description: this.description,
      amount: this.amount,
      category: this.category,
      date: new Date(),
      month: getCurrentMonth()
    });

    this.description = '';
    this.amount = 0;
  }
}
