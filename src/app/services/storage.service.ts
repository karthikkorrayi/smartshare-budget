import { Injectable } from '@angular/core';
import { BudgetPlan } from '../models';

const KEY = 'smartshare_plans_v1';
const KEY_EXPENSES = 'smartshare_month_expenses_v1';

export interface MonthExpense {
  id: string;        // uuid
  monthISO: string;  // YYYY-MM
  name: string;
  amount: number;
  done: boolean;
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readAll(): BudgetPlan[] {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private writeAll(plans: BudgetPlan[]): void {
    localStorage.setItem(KEY, JSON.stringify(plans));
  }

  save(plan: BudgetPlan): void {
    const plans = this.readAll();
    const idx = plans.findIndex(p => p.id === plan.id);
    if (idx >= 0) plans[idx] = plan; else plans.push(plan);
    this.writeAll(plans);
  }

  get(id: string): BudgetPlan | undefined {
    return this.readAll().find(p => p.id === id);
  }

  all(): BudgetPlan[] {
    return this.readAll().sort((a, b) => b.createdAt - a.createdAt);
  }

  remove(id: string): void {
    const plans = this.readAll().filter(p => p.id !== id);
    this.writeAll(plans);
  }

  private readGoals(): any[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {
      return [];
    }
  }

  private writeGoals(rows: any[]) {
    localStorage.setItem(KEY, JSON.stringify(rows));
  }

  saveGoal(g: any) {
    const a = this.readGoals();
    const i = a.findIndex(x => x.id === g.id);
    i >= 0 ? (a[i] = g) : a.push(g);
    this.writeGoals(a);
  }

  getGoal(id: string) {
    return this.readGoals().find(x => x.id === id);
  }

  allGoals() {
    return this.readGoals().sort((a, b) => b.createdAt - a.createdAt);
  }

  private readMonthMap(): Record<string, MonthExpense[]> {
    try {
      return JSON.parse(localStorage.getItem(KEY_EXPENSES) || '{}');
    } catch {
      return {};
    }
  }

  private writeMonthMap(map: Record<string, MonthExpense[]>): void {
    localStorage.setItem(KEY_EXPENSES, JSON.stringify(map));
  }

  getMonthExpenses(monthISO: string): MonthExpense[] {
    const m = this.readMonthMap();
    const list = m[monthISO] || [];
    return list.map(x => ({ ...x }));
  }

  saveMonthExpenses(monthISO: string, rows: MonthExpense[]): void {
    const m = this.readMonthMap();
    m[monthISO] = rows.map(x => ({ ...x, monthISO }));
    this.writeMonthMap(m);
  }

  copyToNextMonth(monthISO: string): string {
    const cur = this.getMonthExpenses(monthISO);
    const d = new Date(monthISO + '-01');
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const nextISO = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    const cloned: MonthExpense[] = cur.map(e => ({
      ...e,
      id: crypto.randomUUID(),
      monthISO: nextISO,
      done: false,
    }));
    this.saveMonthExpenses(nextISO, cloned);
    return nextISO;
  }
}