import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';

import { NgxEchartsDirective } from 'ngx-echarts';
import * as XLSX from 'xlsx';

import { StorageService } from '../../services/storage.service';
import { PlannerService, Principle, TargetPlan } from '../../services/planner.service';
import { BudgetPlan } from '../../models';

@Component({
  selector: 'app-target-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatCardModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule,
    MatInputModule, MatIconModule,
    NgxEchartsDirective
  ],
  templateUrl: './target-dashboard.component.html',
  styleUrl: './target-dashboard.component.scss'
})
export class TargetDashboardComponent implements OnInit {
  plan!: TargetPlan;

  principle: Principle = 'Balanced';
  customMonthly = 0;
  stepPct = 0.05;

  pieOptions: any;
  lineOptions: any;
  tips: string[] = [];

  expenseList: string[] = [];

  expenseView: { name: string; amount: number; icon: string }[] = [];
  private iconMap: Record<string, string> = {
    'rent': 'home',
    'food & dining': 'restaurant',
    'dining': 'restaurant',
    'travel': 'flight',
    'entertainment': 'movie',
    'shopping': 'shopping_bag',
    'household and groceries': 'chair',
  };

  constructor(
    private route: ActivatedRoute,
    private store: StorageService,
    private planner: PlannerService
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    const p = this.store.getGoal(id);
    if (!p) return;
    this.plan = p;
    this.principle = this.plan.chosen.principle;
    this.customMonthly = this.plan.chosen.monthly;
    this.refreshVisuals();
  }

  private normalizeExpenses() {
    if (!Array.isArray(this.plan.expenses)) this.plan.expenses = [];
    this.plan.expenses = this.plan.expenses
      .map(e => ({
        name: String((e?.name ?? '')).trim(),
        amount: Math.max(0, Number(e?.amount ?? 0)) || 0
      }))
      .filter(e => e.name.length || e.amount > 0);
  }

  expensesChanged() {
    this.normalizeExpenses();
    this.store.saveGoal(this.plan);
    this.refreshVisuals();
  }

  addExpenseRow() {
    this.plan.expenses ??= [];
    this.plan.expenses.push({ name: '', amount: 0 });
    this.expensesChanged();
  }

  removeExpenseRow(i: number) {
    this.plan.expenses.splice(i, 1);
    this.expensesChanged();
  }

  refreshVisuals() {
    if (!this.plan) return;

    const base = this.planner.baseline(this.plan.incomeMin, this.plan.baselineSavingsOn);
    const lf = this.planner.leftover(this.plan.incomeMin, this.plan.expenses, base);
    const sugg = this.planner.suggestMonthly(lf);

    let schedule;
    if (this.principle === 'Balanced') {
      schedule = this.planner.buildFlat(this.plan.price, this.plan.chosen.startMonth, sugg.balanced);
      this.customMonthly = sugg.balanced;
    } else if (this.principle === 'FastTrack') {
      schedule = this.planner.buildFlat(this.plan.price, this.plan.chosen.startMonth, sugg.fast);
      this.customMonthly = sugg.fast;
    } else if (this.principle === 'Stepping') {
      schedule = this.planner.buildStepping(this.plan.price, this.plan.chosen.startMonth, sugg.stepBase, this.stepPct);
      this.customMonthly = sugg.stepBase;
    } else {
      schedule = this.planner.buildFlat(this.plan.price, this.plan.chosen.startMonth, Math.max(0, this.customMonthly || 0));
    }

    this.plan.schedule = schedule;
    this.plan.monthsRequired = schedule.length;
    this.plan.chosen = {
      principle: this.principle,
      monthly: this.customMonthly,
      startMonth: this.plan.chosen.startMonth,
      stepPct: this.stepPct
    };

    const expTotal = this.planner.sumExpenses(this.plan.expenses);
    this.pieOptions = {
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: '60%',
        data: [
          { name: 'Existing Payments', value: expTotal },
          { name: 'Baseline Savings', value: base },
          { name: 'Product Contribution', value: this.customMonthly }
        ]
      }]
    };

    this.lineOptions = {
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: schedule.map(s => s.monthISO) },
      yAxis: { type: 'value' },
      series: [{ type: 'line', data: schedule.map(s => s.cum) }]
    };

    this.tips = this.planner.tips(this.plan, this.plan);
    this.store.saveGoal(this.plan);
    
    const nonZero = (this.plan.expenses || []).filter(
      e => String(e?.name ?? '').trim().length && Number(e?.amount ?? 0) > 0
    );
    this.expenseList = nonZero.map(e => String(e.name).trim());
  }

  toggleDone(row: any) { row.done = !row.done; this.store.saveGoal(this.plan); }

  exportExcel() {
    const rows = this.plan.schedule.map(s => ({
      Month: s.monthISO, Amount: s.amount, Cumulative: s.cum, Done: s.done ? 'Yes' : 'No'
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    const meta = [[
      'Title', this.plan.title,
      'Price', this.plan.price,
      'Principle', this.plan.chosen.principle,
      'Monthly', this.plan.chosen.monthly,
      'Start', this.plan.chosen.startMonth
    ]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), 'Meta');
    XLSX.writeFile(wb, `Target_${this.plan.title.replace(/\s+/g, '_')}.xlsx`);
  }
}
