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
  private currentMonthSubject = new BehaviorSubject<string>('');

  receivables$ = this.receivablesSubject.asObservable();
  expenses$ = this.expensesSubject.asObservable();
  incomes$ = this.incomesSubject.asObservable();

  initializeState(month: string) {
    this.currentMonthSubject.next(month);
    this.loadReceivables(month);
    this.loadExpenses(month);
    this.loadIncomes(month);
  }

  setCurrentMonth(month: string) {
    this.currentMonthSubject.next(month);
    this.loadReceivables(month);
    this.loadExpenses(month);
    this.loadIncomes(month);
  }

  private loadReceivables(month: string) {
    this.receivableService.getByMonth(month).subscribe(data => {
      const sortedData = [...data].sort((a, b) => {
        const dateA = a['createdAt']?.seconds ? new Date(a['createdAt'].seconds * 1000).getTime() : 0;
        const dateB = b['createdAt']?.seconds ? new Date(b['createdAt'].seconds * 1000).getTime() : 0;
        return dateB - dateA;
      });
      this.receivablesSubject.next(sortedData);
    });
  }

  private loadExpenses(month: string) {
    this.expenseService.getExpensesByMonth(month).subscribe((data: any[]) => {
      this.expensesSubject.next(data);
    });
  }

  private loadIncomes(month: string) {
    this.incomeService.getIncomeByMonth(month).subscribe((data: any[]) => {
      this.incomesSubject.next(data);
    });
  }

  async addReceivable(receivableData: any) {
    const { title, amount, monthKey } = receivableData;
    const month = this.currentMonthSubject.value;

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

    this.loadReceivables(month);
    this.loadExpenses(month);
  }

  async addExpense(expenseData: any) {
    const month = this.currentMonthSubject.value;
    await this.expenseService.addExpense(expenseData);
    this.loadExpenses(month);
  }

  async markReceivableAsPaid(receivable: any, monthKey: string) {
    const month = this.currentMonthSubject.value;
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

    this.loadReceivables(month);
    this.loadExpenses(month);
    this.loadIncomes(month);
  }

  async deleteReceivable(receivableId: string) {
    const month = this.currentMonthSubject.value;
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

    this.loadReceivables(month);
    this.loadExpenses(month);
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