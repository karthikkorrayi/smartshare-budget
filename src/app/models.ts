export type BudgetType = 'House' | 'Personal' | 'Loan' | 'Trip' | 'Others' | 'Savings';

export interface BudgetCategories {
  house: number;
  personal: number;
  loan: number;
  trip: number;
  others: number;
  savings: number;
}

export interface BudgetPlan {
  id: string;            // e.g., `${year}-${month}`
  month: string;         // e.g., '2025-08'
  income: number;
  categories: BudgetCategories;
  priorities: BudgetType[]; // user-chosen priorities
  fixed: Partial<BudgetCategories>; // amounts locked by user
  generatedByAI: boolean;
  createdAt: number;     // Date.now()
}