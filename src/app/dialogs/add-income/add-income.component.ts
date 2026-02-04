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
        <div class="form-section">
          <label class="section-label">Income Source</label>
          <input
            type="text"
            placeholder="Salary, Freelance, Bonus..."
            [(ngModel)]="income.source"
            class="form-input">
        </div>

        <div class="form-section">
          <label class="section-label">Amount (₹)</label>
          <input
            type="number"
            placeholder="0.00"
            [(ngModel)]="income.amount"
            class="form-input">
        </div>
      </div>

      <div class="form-actions">
        <button (click)="close()" class="btn btn-secondary">Cancel</button>
        <button (click)="save()" class="btn btn-primary">Save Income</button>
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