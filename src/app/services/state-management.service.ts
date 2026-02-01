import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { switchMap, map, shareReplay } from 'rxjs/operators';
import { ReceivableService } from './receivable.service';
import { ExpenseService } from './expense.service';
import { IncomeService } from './income.service';

@Injectable({ providedIn: 'root' })
export class StateManagementService {
  private receivableService = inject(ReceivableService);
  private expenseService = inject(ExpenseService);
  private incomeService = inject(IncomeService);

  private currentMonthSubject = new BehaviorSubject<string>('');

  currentMonth$ = this.currentMonthSubject.asObservable();

  receivables$ = this.currentMonthSubject.pipe(
    switchMap(month => month ? this.receivableService.getByMonth(month) : of([])),
    map(data => [...data].sort((a, b) => {
      const dateA = a['createdAt']?.seconds ? new Date(a['createdAt'].seconds * 1000).getTime() : 0;
      const dateB = b['createdAt']?.seconds ? new Date(b['createdAt'].seconds * 1000).getTime() : 0;
      return dateB - dateA;
    })),
    shareReplay(1)
  );

  expenses$ = this.currentMonthSubject.pipe(
    switchMap(month => month ? this.expenseService.getExpensesByMonth(month) : of([])),
    shareReplay(1)
  );

  incomes$ = this.currentMonthSubject.pipe(
    switchMap(month => month ? this.incomeService.getIncomeByMonth(month) : of([])),
    shareReplay(1)
  );

  initializeState(month: string) {
    this.currentMonthSubject.next(month);
  }

  setCurrentMonth(month: string) {
    this.currentMonthSubject.next(month);
  }

  getCurrentMonth(): string {
    return this.currentMonthSubject.value;
  }

  async addReceivable(receivableData: any) {
    const { title, amount, monthKey } = receivableData;

    await this.receivableService.add({
      title,
      amount,
      createdAt: new Date(),
      status: 'PENDING',
      month: monthKey
    });

    await this.expenseService.addExpense({
      description: `Lent: ${title}`,
      amount,
      category: 'Lent',
      date: new Date(),
      month: monthKey
    });
  }

  async addExpense(expenseData: any) {
    await this.expenseService.addExpense(expenseData);
  }

  async markReceivableAsPaid(receivable: any, monthKey: string, expenses: any[]) {
    if (receivable.status === 'PAID') {
      return;
    }

    await this.receivableService.update(receivable.id, {
      status: 'PAID',
      paidDate: new Date()
    });

    await this.incomeService.addIncome({
      source: `Received from ${receivable.title}`,
      amount: receivable.amount,
      date: new Date(),
      month: monthKey,
      isSystemGenerated: true
    });

    const linkedExpense = expenses.find(
      (exp: any) => exp.description === `Lent: ${receivable.title}`
    );

    if (linkedExpense) {
      await this.expenseService.updateExpense({
        ...linkedExpense,
        status: 'PAID',
        paidDate: new Date()
      });
    }
  }

  async deleteReceivable(receivableId: string, receivables: any[], expenses: any[]) {
    const receivable = receivables.find(
      (r: any) => r.id === receivableId
    );

    if (!receivable) return;

    if (receivable.status === 'PAID') {
      return;
    }

    const linkedExpense = expenses.find(
      (exp: any) => exp.description === `Lent: ${receivable.title}`
    );

    if (linkedExpense) {
      await this.expenseService.deleteExpense(linkedExpense.id);
    }

    await this.receivableService.delete(receivableId);
  }
}