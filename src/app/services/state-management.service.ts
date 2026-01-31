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

    this.loadReceivables();
    this.loadExpenses();
  }

  async addExpense(expenseData: any) {
    await this.expenseService.addExpense(expenseData);
    this.loadExpenses();
  }

  async markReceivableAsPaid(receivable: any, monthKey: string) {
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

    const linkedExpense = this.expensesSubject.value.find(
      (exp: any) => exp.description === `Lent: ${receivable.title}`
    );

    if (linkedExpense) {
      await this.expenseService.updateExpense({
        ...linkedExpense,
        status: 'PAID',
        paidDate: new Date()
      });
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

    if (receivable.status === 'PAID') {
      return;
    }

    const linkedExpense = this.expensesSubject.value.find(
      (exp: any) => exp.description === `Lent: ${receivable.title}`
    );

    if (linkedExpense) {
      await this.expenseService.deleteExpense(linkedExpense.id);
    }

    await this.receivableService.delete(receivableId);

    this.loadReceivables();
    this.loadExpenses();
  }

  getReceivablesSnapshot() {
    return this.receivablesSubject.getValue();
  }

  getExpensesSnapshot() {
    return this.expensesSubject.getValue();
  }

  getIncomesSnapshot() {
    return this.incomesSubject.getValue();
  }
}