import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { IncomeService } from '../../services/income.service';
import { getCurrentMonth } from '../../utils/date.util';

@Component({
  standalone: true,
  selector: 'app-income',
  imports: [CommonModule, FormsModule, MatInputModule, MatButtonModule],
  template: `
    <section class="entry-page">
      <a href="#/" class="back-link">← Back to overview</a>
      <p class="eyebrow">MONEY IN</p><h1>Add income</h1>
      <p class="entry-hint">Give your earnings a place in your monthly budget.</p>
      <div class="entry-card">
        <label for="income-source">Income source</label>
        <input matInput id="income-source" placeholder="e.g. Salary or freelance work" [(ngModel)]="source">
        <label for="income-amount">Amount (₹)</label>
        <input matInput id="income-amount" type="number" min="0" placeholder="0" [(ngModel)]="amount">
        <button mat-raised-button (click)="save()">Add income</button>
      </div>
    </section>
  `,
  styleUrl: './income.component.scss',
})
export class IncomeComponent {
  source = '';
  amount = 0;

  constructor(private incomeService: IncomeService) {}

  save() {
    this.incomeService.addIncome({
      source: this.source,
      amount: this.amount,
      date: new Date(),
      month: getCurrentMonth()
    });

  this.source = '';
  this.amount = 0;
  }

}
