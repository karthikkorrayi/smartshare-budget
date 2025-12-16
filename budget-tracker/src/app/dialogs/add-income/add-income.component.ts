import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { IncomeService } from '../../services/income.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2>{{ data?.income ? 'Edit Income' : 'Add Income' }}</h2>

    <input
      placeholder="Source (Salary, Freelance...)"
      [(ngModel)]="income.source">

    <input
      type="number"
      placeholder="Amount"
      [(ngModel)]="income.amount">

    <div class="actions">
      <button (click)="save()">Save</button>
      <button (click)="close()">Cancel</button>
    </div>
  `
})
export class AddIncomeComponent {

  income: any = {
    source: '',
    amount: 0
  };

  constructor(
    private dialogRef: MatDialogRef<AddIncomeComponent>,
    private incomeService: IncomeService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    if (data?.income) {
      this.income = { ...data.income };
    }
  }

  save() {
    if (this.income.id) {
      this.incomeService.updateIncome(this.income);
    } else {
      this.incomeService.addIncome({
        ...this.income,
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
