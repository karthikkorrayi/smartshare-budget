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
    <h2>Add Income</h2>

    <input matInput placeholder="Source" [(ngModel)]="source">
    <input matInput type="number" placeholder="Amount" [(ngModel)]="amount">

    <button mat-raised-button color="primary" (click)="save()">Add</button>
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
