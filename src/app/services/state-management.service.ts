import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { switchMap, map, shareReplay, startWith } from 'rxjs/operators';
import { ReceivableService } from './receivable.service';
import { ExpenseService } from './expense.service';
import { IncomeService } from './income.service';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class StateManagementService {
  private receivableService = inject(ReceivableService);
  private expenseService = inject(ExpenseService);
  private incomeService = inject(IncomeService);
  private authService = inject(AuthService);

  private currentMonthSubject = new BehaviorSubject<string>('');
  private loadingSubject = new BehaviorSubject<boolean>(false);

  currentMonth$ = this.currentMonthSubject.asObservable();
  loading$ = this.loadingSubject.asObservable();

  // Filter receivables by current user
  receivables$ = this.authService.getCurrentUser().pipe(
    switchMap(user => {
      if (!user) return of([]);
      return this.receivableService.getAll().pipe(
        map(data => [...data]
          .filter(item => item['userId'] === user.uid)
          .sort((a, b) => {
            const dateA = a['createdAt']?.seconds ? new Date(a['createdAt'].seconds * 1000).getTime() : 0;
            const dateB = b['createdAt']?.seconds ? new Date(b['createdAt'].seconds * 1000).getTime() : 0;
            return dateB - dateA;
          })
        )
      );
    }),
    shareReplay(1)
  );

  // Filter expenses by current user and month
  expenses$ = this.authService.getCurrentUser().pipe(
    switchMap(user => {
      if (!user) return of([]);
      return this.currentMonthSubject.pipe(
        switchMap(month => {
          if (!month) return of([]);
          return this.expenseService.getExpensesByMonth(month).pipe(
            map(data => data.filter(item => item['userId'] === user.uid)),
            startWith([])
          );
        })
      );
    }),
    shareReplay(1)
  );

  // Filter incomes by current user and month
  incomes$ = this.authService.getCurrentUser().pipe(
    switchMap(user => {
      if (!user) return of([]);
      return this.currentMonthSubject.pipe(
        switchMap(month => {
          if (!month) return of([]);
          return this.incomeService.getIncomeByMonth(month).pipe(
            map(data => data.filter(item => item['userId'] === user.uid)),
            startWith([])
          );
        })
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

  async addReceivable(receivableData: any) {
    const { title, amount, monthKey, trackInExpenses } = receivableData;
    const userId = this.authService.getCurrentUserId();

    if (!userId) {
      throw new Error('User not authenticated');
    }

    // No 'month' stored on the document — receivables are global
    await this.receivableService.add({
      title,
      amount,
      userId, // Add user ID for filtering
      createdAt: new Date(),
      status: 'PENDING',
      trackInExpenses: !!trackInExpenses
    });

    // Only create a Lent expense when the user opted in
    if (trackInExpenses) {
      await this.expenseService.addExpense({
        description: `Lent: ${title}`,
        amount,
        category: 'Lent',
        date: new Date(),
        month: monthKey,
        userId
      });
    }
  }

  async addExpense(expenseData: any) {
    const userId = this.authService.getCurrentUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }
    await this.expenseService.addExpense({ ...expenseData, userId });
  }

  async markReceivableAsPaid(receivable: any, monthKey: string, expenses: any[]) {
    if (receivable.status === 'PAID') return;

    const userId = this.authService.getCurrentUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    await this.receivableService.update(receivable.id, {
      status: 'PAID',
      paidDate: new Date(),
      paidInMonth: monthKey
    });

    await this.incomeService.addIncome({
      source: `Received from ${receivable.title}`,
      amount: receivable.amount,
      date: new Date(),
      month: monthKey,
      isSystemGenerated: true,
      userId
    });

    // Only touch the linked expense if this receivable was tracked in spending
    if (receivable.trackInExpenses) {
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
  }

  async deleteReceivable(receivableId: string, receivables: any[], expenses: any[]) {
    const receivable = receivables.find((r: any) => r.id === receivableId);

    if (!receivable || receivable.status === 'PAID') return;

    if (receivable.trackInExpenses) {
      const linkedExpense = expenses.find(
        (exp: any) => exp.description === `Lent: ${receivable.title}`
      );
      if (linkedExpense) {
        await this.expenseService.deleteExpense(linkedExpense.id);
      }
    }

    await this.receivableService.delete(receivableId);
  }
}
