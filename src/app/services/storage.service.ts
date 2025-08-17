import { Injectable } from '@angular/core';
import { BudgetPlan } from '../models';

const KEY = 'smartshare_plans_v1';

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

  all(): BudgetPlan[] { return this.readAll().sort((a,b) => b.createdAt - a.createdAt); }

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
    const i = a.findIndex(x=>x.id===g.id); 
    i>=0? a[i]=g: a.push(g); 
    this.writeGoals(a); 
  }

  getGoal(id: string) { 
    return this.readGoals().find(x=>x.id===id); 
  }

  allGoals() { 
    return this.readGoals().sort((a,b)=> b.createdAt - a.createdAt); 
  }
}