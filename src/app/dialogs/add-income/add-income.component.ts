import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { IncomeService } from '../../services/income.service';

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
          <input
            type="text"
            id="source"
            [(ngModel)]="income.source"
            class="floating-input"
            placeholder=" ">
          <label for="source" class="floating-label">Income Source</label>
        </div>

        <div class="input-group">
          <input
            type="number"
            id="amount"
            [(ngModel)]="income.amount"
            class="floating-input"
            placeholder=" ">
          <label for="amount" class="floating-label">Amount (₹)</label>
        </div>
      </div>

      <div class="form-actions">
        <button (click)="close()" class="btn btn-cancel">
          <span class="btn-content">Cancel</span>
        </button>
        <button (click)="save()" class="btn btn-save">
          <span class="btn-content">Save Income</span>
        </button>
      </div>
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