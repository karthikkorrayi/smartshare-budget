import { Injectable } from '@angular/core';

export type Principle = 'Balanced' | 'FastTrack' | 'Stepping' | 'Custom';
export interface ExpenseItem { name: string; amount: number; }

export interface TargetGoalInput {
  title: string;
  price: number;          // target cost
  incomeMin: number;      // conservative floor
  incomeMax: number;      // not used in math yet, for tips
  expenses: ExpenseItem[];
  baselineSavingsOn: boolean; // general savings?
}

export interface ScheduleRow { monthISO: string; amount: number; done: boolean; cum: number; }

export interface TargetPlan extends TargetGoalInput {
  id: string;
  leftover: number;
  chosen: { principle: Principle; monthly: number; startMonth: string; stepPct?: number };
  monthsRequired: number;
  schedule: ScheduleRow[];
  createdAt: number;
}

@Injectable({ providedIn: 'root' })
export class PlannerService {
  baseline(incomeMin: number, on: boolean) { return on ? Math.round(incomeMin * 0.10) : 0; }
  sumExpenses(items: ExpenseItem[]) { return items.reduce((s,i)=> s + (Number(i.amount)||0), 0); }
  leftover(incomeMin: number, expenses: ExpenseItem[], baseline: number) { return Math.max(0, incomeMin - this.sumExpenses(expenses) - baseline); }

  // Suggest monthly amounts based on leftover
  suggestMonthly(leftover: number) {
    const balanced = Math.round(leftover * 0.70);
    const fast     = Math.round(leftover * 0.90);
    const stepBase = Math.round(leftover * 0.60);
    return { balanced, fast, stepBase };
  }

  // Months required at given monthly amount
  monthsFor(price: number, monthly: number) {
    if (monthly <= 0) return Infinity;
    return Math.ceil(price / monthly);
  }

  // Increasing monthly amount on default 5%
  buildStepping(price: number, startMonthISO: string, base: number, stepPct = 0.05): ScheduleRow[] {
    const rows: ScheduleRow[] = [];
    let cum = 0, m = 0;
    const d0 = new Date(startMonthISO + '-01');
    while (cum < price && m < 600) {
      const amt = Math.round(base * (1 + stepPct * m));
      cum += amt;
      const d = new Date(d0.getFullYear(), d0.getMonth() + m, 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      rows.push({ monthISO: iso, amount: amt, done: false, cum });
      m++;
    }
    return rows;
  }

  // Simple fixed monthly amount until done
  buildFlat(price: number, startMonthISO: string, monthly: number): ScheduleRow[] {
    const rows: ScheduleRow[] = [];
    let cum = 0, m = 0; const d0 = new Date(startMonthISO + '-01');
    while (cum < price && m < 600) {
      cum += monthly;
      const d = new Date(d0.getFullYear(), d0.getMonth() + m, 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      rows.push({ monthISO: iso, amount: monthly, done: false, cum });
      m++;
    }
    return rows;
  }

  // Provide some tips based on input and plan
  tips(input: TargetGoalInput, plan: TargetPlan): string[] {
    const tips: string[] = [];
    const base = this.baseline(input.incomeMin, input.baselineSavingsOn);
    const exp  = this.sumExpenses(input.expenses);
    const lf   = this.leftover(input.incomeMin, input.expenses, base);
    if (base>0 && base < input.incomeMin*0.10) tips.push('Try to save at least 10% as a baseline.');
    if (exp > input.incomeMin*0.55) tips.push('Your fixed payments exceed ~55% of income; consider trimming “Others”.');
    if (lf <= 0) tips.push('Leftover is zero/negative. Reduce some expense or increase income range to start saving.');
    if (input.incomeMax > input.incomeMin) tips.push(`If income reaches ₹${input.incomeMax}, add some of the difference to finish sooner.`);
    return tips;
  }

  // Standard EMI calculation.
  emi(principal: number, annualRatePct: number, months: number) {
    const P = Math.max(0, Number(principal)||0);
    const r = Math.max(0, Number(annualRatePct)||0) / 12 / 100;
    const n = Math.max(1, Number(months)||1);
    if (r === 0) return Math.ceil(P / n);
    const E = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    return Math.ceil(E);
  }

  // Build cumulative payoff schedule for EMI
  buildEmiSchedule(principal: number, annualRatePct: number, months: number, startMonthISO: string) {
    const rows: { monthISO: string; amount: number; done: boolean; cum: number }[] = [];
    const emiAmt = this.emi(principal, annualRatePct, months);
    let cum = 0;
    const d0 = new Date(startMonthISO + '-01');
    for (let m = 0; m < months; m++) {
      cum += emiAmt;
      const d = new Date(d0.getFullYear(), d0.getMonth() + m, 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      rows.push({ monthISO: iso, amount: emiAmt, done: false, cum });
    }
    return rows;
  }

  // Months from now until target YYYY-MM
  monthsUntil(targetMonthISO: string) {
    const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
    const [ty, tm] = targetMonthISO.split('-').map(x=>Number(x));
    const diff = (ty - y) * 12 + (tm - 1 - m);
    return Math.max(1, diff+1);
  }
}