import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { switchMap, map, shareReplay, startWith } from 'rxjs/operators';
import { ReceivableService } from './receivable.service';
import { ExpenseService } from './expense.service';
import { IncomeService } from './income.service';

import { monthKey } from '../utils/date-input.util';

@Injectable({ providedIn: 'root' })
export class StateManagementService {
  private receivableService = inject(ReceivableService);
  private expenseService = inject(ExpenseService);
  private incomeService = inject(IncomeService);

  private currentMonthSubject = new BehaviorSubject<string>('');
  private loadingSubject = new BehaviorSubject<boolean>(false);

  currentMonth$ = this.currentMonthSubject.asObservable();
  loading$ = this.loadingSubject.asObservable();

  receivables$ = this.receivableService.getAll().pipe(
    map(data => [...data].sort((a, b) => {
      const dateA = a['createdAt']?.seconds ? new Date(a['createdAt'].seconds * 1000).getTime() : 0;
      const dateB = b['createdAt']?.seconds ? new Date(b['createdAt'].seconds * 1000).getTime() : 0;
      return dateB - dateA;
    })),
    shareReplay(1)
  );

  expenses$ = this.currentMonthSubject.pipe(
    switchMap(month => {
      if (!month) return of([]);
      return this.expenseService.getExpensesByMonth(month).pipe(
        startWith([])
      );
    }),
    shareReplay(1)
  );

  incomes$ = this.currentMonthSubject.pipe(
    switchMap(month => {
      if (!month) return of([]);
      return this.incomeService.getIncomeByMonth(month).pipe(
        startWith([])
      );
    }),
    shareReplay(1)
  );

  initializeState(month: string) {
    this.currentMonthSubject.next(month);
  }

  setCurrentMonth(month: string) {
    this.loadingSubject.next(true);
    this.currentMonthSubject.next(month);
    this.loadingSubject.next(false);
  }

  getCurrentMonth(): string {
    return this.currentMonthSubject.value;
  }

  clearCache() {
    this.currentMonthSubject.next('');
  }

  /**
   * Lending money (receivables).
   * - "Add to Spending Summary" ON  → a Lent expense today; repayment later = income on the day it's received.
   *   Net effect over time: 0 (money out, money back in).
   * - OFF → nothing is booked now, so nothing is booked on repayment either (watch-only).
   * The Lent expense is linked by id (lentExpenseId), not by matching its description text.
   */
  async addReceivable(receivableData: any) {
    const { title, amount, trackInExpenses } = receivableData;
    const today = new Date();

    let lentExpenseId: string | null = null;
    if (trackInExpenses) {
      const ref = await this.expenseService.addExpense({
        description: `Lent: ${title}`,
        amount,
        category: 'Lent',
        date: today,
        month: monthKey(today),
      });
      lentExpenseId = ref.id;
    }

    await this.receivableService.add({
      title,
      amount,
      createdAt: today,
      status: 'PENDING',
      trackInExpenses: !!trackInExpenses,
      ...(lentExpenseId ? { lentExpenseId } : {}),
    });
  }

  async addExpense(expenseData: any) {
    await this.expenseService.addExpense(expenseData);
  }

  /**
   * Repayment received. Previously this BOTH marked the Lent expense as PAID (removing the outflow)
   * AND added income — so lending ₹1,000 and getting it back showed ₹1,000 extra. Now:
   * tracked → income on the repayment day (the Lent expense stays as the original outflow);
   * watch-only → no income (nothing was booked when lending).
   */
  async markReceivableAsPaid(receivable: any) {
    if (receivable.status === 'PAID') return;
    const today = new Date();

    await this.receivableService.update(receivable.id, {
      status: 'PAID',
      paidDate: today,
      paidInMonth: monthKey(today),
    });

    if (receivable.trackInExpenses) {
      await this.incomeService.addIncome({
        source: `Received from ${receivable.title}`,
        amount: receivable.amount,
        date: today,
        month: monthKey(today),
        isSystemGenerated: true,
      });
    }
  }

  async deleteReceivable(receivableId: string, receivables: any[], expenses: any[]) {
    const receivable = receivables.find((r: any) => r.id === receivableId);
    if (!receivable || receivable.status === 'PAID') return;

    if (receivable.trackInExpenses) {
      if (receivable.lentExpenseId) {
        await this.expenseService.deleteExpense(receivable.lentExpenseId);
      } else {
        // Older receivables (before lentExpenseId existed): best-effort match in the loaded month.
        const linked = expenses.find((exp: any) => exp.description === `Lent: ${receivable.title}` && exp.amount === receivable.amount);
        if (linked) await this.expenseService.deleteExpense(linked.id);
      }
    }

    await this.receivableService.delete(receivableId);
  }
}
