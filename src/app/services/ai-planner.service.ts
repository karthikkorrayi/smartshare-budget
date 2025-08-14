import { Injectable } from '@angular/core';
import { BudgetPlan, BudgetCategories, BudgetType } from '../models';

@Injectable({ providedIn: 'root' })
export class AiPlannerService {
  /**
   * Generate allocations using simple rules & priorities.
   * - Enforces minimum savings (10%) unless fixed overrides
   * - Respects user fixed values, and redistributes the rest by priority
   */
  generatePlan(
    month: string,
    income: number,
    priorities: BudgetType[],
    fixed: Partial<BudgetCategories> = {}
  ): BudgetPlan {
    const base: BudgetCategories = {
      house: 0, personal: 0, loan: 0, trip: 0, others: 0, savings: 0,
    };

    // 1) Lock fixed amounts first
    const lockedTotal = (Object.keys(fixed) as (keyof BudgetCategories)[])
      .reduce((sum, k) => sum + (fixed[k] ?? 0), 0);

    const remain = Math.max(0, income - lockedTotal);

    // 2) Default ratios (can be tuned)
    // House 30%, Loan 20%, Personal 15%, Trip 10%, Others 5%, Savings 20%
    const ratios: Record<BudgetType, number> = {
      House: 0.30, Loan: 0.20, Personal: 0.15, Trip: 0.10, Others: 0.05, Savings: 0.20
    } as const;

    // 3) Priority bonus: +5% per priority (drawn from Others -> Savings first)
    const ratioBoost: Record<BudgetType, number> = { House:0, Personal:0, Loan:0, Trip:0, Others:0, Savings:0 };
    priorities.forEach(p => ratioBoost[p] = (ratioBoost[p] ?? 0) + 0.05);

    // Normalize boosted ratios to sum ~1.0
    const totalBase = Object.values(ratios).reduce((a,b)=>a+b,0);
    let boosted = (Object.keys(ratios) as BudgetType[]).reduce((acc, k) => {
      acc[k] = ratios[k] + (ratioBoost[k] ?? 0);
      return acc;
    }, {} as Record<BudgetType, number>);

    const sumBoosted = (Object.values(boosted) as number[]).reduce((a,b)=>a+b,0);
    (Object.keys(boosted) as BudgetType[]).forEach(k => { boosted[k] = boosted[k] / sumBoosted; });

    // 4) Apply to remaining income, add fixed back
    base.house   = Math.round((remain * boosted['House'])   + (fixed.house   ?? 0));
    base.loan    = Math.round((remain * boosted['Loan'])    + (fixed.loan    ?? 0));
    base.personal= Math.round((remain * boosted['Personal'])+ (fixed.personal?? 0));
    base.trip    = Math.round((remain * boosted['Trip'])    + (fixed.trip    ?? 0));
    base.others  = Math.round((remain * boosted['Others'])  + (fixed.others  ?? 0));

    // Savings: ensure minimum 10% of income unless user fixed higher
    const minSavings = Math.floor(income * 0.10);
    const savingsAuto = Math.round(remain * boosted['Savings']);
    base.savings = Math.max(minSavings, savingsAuto, (fixed.savings ?? 0));

    // 5) Adjust if total exceeds income (rounding/constraints)
    let total = base.house + base.loan + base.personal + base.trip + base.others + base.savings;
    if (total > income) {
      const over = total - income;
      // reduce from Others -> Trip -> Personal order
      const drain: (keyof BudgetCategories)[] = ['others','trip','personal','house','loan','savings'];
      let left = over;
      for (const k of drain) {
        const cut = Math.min(left, base[k]);
        base[k] -= cut;
        left -= cut;
        if (left <= 0) break;
      }
    }

    const plan: BudgetPlan = {
      id: month,
      month,
      income,
      categories: base,
      priorities,
      fixed,
      generatedByAI: true,
      createdAt: Date.now(),
    };

    return plan;
  }

  /** Simple tips based on plan */
  tips(plan: BudgetPlan): string[] {
    const tips: string[] = [];
    const { income, categories } = plan;

    if (categories.savings < income * 0.10) tips.push('Try to save at least 10% of your income.');
    if (categories.loan > income * 0.35) tips.push('Loan/EMI seems high; consider refinancing or extra payments when possible.');
    if (categories.trip > income * 0.15) tips.push('Trip/Travel is high; reduce discretionary travel this month.');
    if ((categories.house + categories.loan) > income * 0.55) tips.push('Housing + EMIs exceed 55%; review rent/EMI obligations.');

    if (plan.priorities.includes('Savings') && categories.savings < income * 0.15) {
      tips.push('You marked Savings as a priority — consider raising it to 15%.');
    }

    return tips;
  }
}