import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { IncomeService } from './income.service';
import { ExpenseService } from './expense.service';
import { AuthService } from './auth.service';
import { monthKey } from '../utils/date-input.util';
import { CardTransactionsService } from './card-transactions.service';
import { MoneyItem, spendValue, walletMoneyItem } from '../utils/budget.util';
import { WalletsService } from './wallets.service';
import { toDate } from '../utils/firestore.util';

/**
 * Carries last month's positive closing balance into this month as one system income entry.
 *
 * Fixed behaviour (was: ran for ANY month you browsed to, once, and never updated):
 * - Only the CURRENT calendar month gets a carry-forward. Browsing to future months no longer
 *   books a balance there early (which used to freeze a wrong amount), and past months are left alone.
 * - It is recalculated every time Overview opens this month, so an expense you add to last month
 *   later still corrects this month's opening balance.
 * - If last month closed at ₹0 or below, any existing carry-forward entry is removed.
 * - Uses exactly Overview's definition of spending: expenses (minus card bill payments, wallet
 *   top-ups and repaid loans) + card purchases − card refunds + wallet spends − wallet refunds.
 */
@Injectable({ providedIn: 'root' })
export class CarryForwardService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private incomeService = inject(IncomeService);
  private expenseService = inject(ExpenseService);
  private cardTxns = inject(CardTransactionsService);
  private wallets = inject(WalletsService);

  /** Name kept for the dashboard; now syncs instead of "process once". */
  async checkAndProcessCarryForward(month: string): Promise<void> {
    if (month !== monthKey(new Date())) return;
    const uid = this.auth.requireUid();
    const previousMonth = this.getPreviousMonth(month);

    const [prevIncome, prevExpenses, prevCards, prevWallet, existing] = await Promise.all([
      firstValueFrom(this.incomeService.getIncomeByMonth(previousMonth)),
      firstValueFrom(this.expenseService.getExpensesByMonth(previousMonth)),
      firstValueFrom(this.cardTxns.byMonth$(previousMonth)),
      firstValueFrom(this.wallets.byMonth$(previousMonth)),
      getDocs(
        query(
          collection(this.firestore, 'income'),
          where('userId', '==', uid),
          where('month', '==', month),
          where('isCarryForward', '==', true)
        )
      ),
    ]);

    const totalIncome = prevIncome.reduce((sum, i: any) => sum + (Number(i.amount) || 0), 0);
    const items: MoneyItem[] = [
      ...prevExpenses.map((e: any) => ({ source: 'expense' as const, amount: Number(e.amount) || 0, date: toDate(e.date), category: e.category, status: e.status })),
      ...prevCards.map(c => ({ source: 'card' as const, amount: c.amount, date: c.txnDate, category: c.category, direction: c.direction })),
      ...prevWallet.map(t => walletMoneyItem(t)),
    ];
    const totalExpenses = items.reduce((sum, i) => sum + spendValue(i), 0);
    const closingBalance = Math.round((totalIncome - totalExpenses) * 100) / 100;

    // Two tabs opening at once could have created duplicates — keep one.
    const [keep, ...extra] = existing.docs;
    await Promise.all(extra.map(d => deleteDoc(d.ref)));

    if (closingBalance <= 0) {
      if (keep) await deleteDoc(keep.ref);
      return;
    }

    if (!keep) {
      await this.createCarryForward(month, previousMonth, closingBalance);
    } else if (Number(keep.get('amount')) !== closingBalance) {
      await updateDoc(doc(this.firestore, 'income', keep.id), { amount: closingBalance });
    }
  }

  private async createCarryForward(month: string, previousMonth: string, amount: number): Promise<void> {
    const [y, m] = previousMonth.split('-').map(Number);
    const label = new Date(y, m - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    const [cy, cm] = month.split('-').map(Number);
    await this.incomeService.addIncome({
      source: 'Carry Forward',
      amount,
      description: `Balance carried forward from ${label}`,
      date: new Date(cy, cm - 1, 1),
      month,
      isSystemGenerated: true,
      isCarryForward: true,
      createdAt: new Date(),
    });
  }

  private getPreviousMonth(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return monthKey(new Date(y, m - 2, 1));
  }
}
