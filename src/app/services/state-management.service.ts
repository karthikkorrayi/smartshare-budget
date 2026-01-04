import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ReceivableService } from './receivable.service';
import { ExpenseService } from './expense.service';
import { IncomeService } from './income.service';

@Injectable({ providedIn: 'root' })
export class StateManagementService {
  private receivableService = inject(ReceivableService);
  private expenseService = inject(ExpenseService);
  private incomeService = inject(IncomeService);

  private receivablesSubject = new BehaviorSubject<any[]>([]);
  private expensesSubject = new BehaviorSubject<any[]>([]);
  private incomesSubject = new BehaviorSubject<any[]>([]);

  receivables$ = this.receivablesSubject.asObservable();
  expenses$ = this.expensesSubject.asObservable();
  incomes$ = this.incomesSubject.asObservable();

  private receivableExpenseMap = new Map<string, string>();

  initializeState() {
    this.loadReceivables();
    this.loadExpenses();
    this.loadIncomes();
  }

  private loadReceivables() {
    this.receivableService.getAll().subscribe(data => {
      this.receivablesSubject.next(data);
    });
  }

  private loadExpenses() {
    this.expenseService.getExpenses().subscribe((data: any[]) => {
      this.expensesSubject.next(data);
    });
  }

  private loadIncomes() {
    this.incomeService.getIncome().subscribe((data: any[]) => {
      this.incomesSubject.next(data);
    });
  }

  async addExpense(expenseData: any) {
    const linkedReceivableId = expenseData.linkedReceivableId;
    delete expenseData.linkedReceivableId;

    await this.expenseService.addExpense(expenseData);

    if (linkedReceivableId) {
      this.receivableExpenseMap.set(linkedReceivableId, expenseData.description);
    }

    this.loadExpenses();
  }

  async markReceivableAsPaid(receivable: any, monthKey: string) {
    await this.receivableService.update(receivable.id, { status: 'PAID' });

    await this.incomeService.addIncome({
      source: `Received from ${receivable.title}`,
      amount: receivable.amount,
      date: new Date(),
      month: monthKey
    });

    const linkedExpense = Array.from(this.expensesSubject.value).find(
      (exp: any) => exp.description === `Lent: ${receivable.title}`
    );

    if (linkedExpense) {
      await this.expenseService.deleteExpense(linkedExpense.id);
    }

    this.loadReceivables();
    this.loadExpenses();
    this.loadIncomes();
  }

  async deleteReceivable(receivableId: string) {
    const receivable = this.receivablesSubject.value.find(
      (r: any) => r.id === receivableId
    );

    if (!receivable) return;

    const linkedExpense = this.expensesSubject.value.find(
      (exp: any) => exp.description === `Lent: ${receivable.title}`
    );

    if (linkedExpense) {
      await this.expenseService.deleteExpense(linkedExpense.id);
    }

    await this.receivableService.delete(receivableId);

    this.receivableExpenseMap.delete(receivableId);

    this.loadReceivables();
    this.loadExpenses();
  }
}
