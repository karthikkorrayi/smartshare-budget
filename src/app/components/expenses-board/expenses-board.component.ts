import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';

import { StorageService, MonthExpense } from '../../services/storage.service';

@Component({
  selector: 'app-expenses-board',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatCheckboxModule, MatInputModule],
  templateUrl: './expenses-board.component.html',
  styleUrl: './expenses-board.component.scss'
})
export class ExpensesBoardComponent {
  monthISO = this.nowISO();
  rows: MonthExpense[] = [];

  constructor(private store: StorageService) { this.load(); }

  nowISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  onMonthChange(){ this.load(); }

  private isoAddMonths(iso: string, delta: number) {
    const d = new Date(iso + '-01');
    const next = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;
  }

  prevMonth(){ this.monthISO = this.isoAddMonths(this.monthISO, -1); this.load(); }
  nextMonth(){ this.monthISO = this.isoAddMonths(this.monthISO, +1); this.load(); }

  load(){ this.rows = this.store.getMonthExpenses(this.monthISO); }

  save(){
    this.rows = this.rows.map(r => ({
      ...r,
      amount: Math.max(0, Number(r.amount) || 0),
      name: String(r.name || '').trim()
    }));
    this.store.saveMonthExpenses(this.monthISO, this.rows);
  }

  add(){
    const row: MonthExpense = {
      id: crypto.randomUUID(),
      monthISO: this.monthISO,
      name: '',
      amount: 0,
      done: false
    };
    this.rows.push(row);
    this.save();
  }

  remove(i:number){ this.rows.splice(i,1); this.save(); }
  toggle(r:MonthExpense){ r.done = !r.done; this.save(); }

  closeAndCreateNext(){
    const nextISO = this.store.copyToNextMonth(this.monthISO);
    this.monthISO = nextISO;
    this.load();
  }

  get total(){ return this.rows.reduce((s,r)=> s + (Number(r.amount)||0), 0); }
}
