import { Injectable, inject } from '@angular/core';
import { Firestore, deleteField, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { IncomeService } from './income.service';
import { ExpenseService } from './expense.service';
import { AuthService } from './auth.service';

/**
 * Carry-forward bookkeeping is now per user:
 *   metadata/{uid} → { processedMonths: { 'YYYY-MM': true }, lastUpdated }
 * Previously one global doc (metadata/carry_forward_metadata) was shared by everyone.
 */
@Injectable({ providedIn: 'root' })
export class CarryForwardService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private incomeService = inject(IncomeService);
  private expenseService = inject(ExpenseService);

  async checkAndProcessCarryForward(currentMonth: string): Promise<void> {
    const uid = this.auth.requireUid();
    const previousMonth = this.getPreviousMonth(currentMonth);

    if (await this.isCarryForwardProcessed(uid, currentMonth)) {
      return;
    }

    const previousIncome = await firstValueFrom(this.incomeService.getIncomeByMonth(previousMonth));
    const previousExpenses = await firstValueFrom(this.expenseService.getExpensesByMonth(previousMonth));

    const totalIncome = previousIncome.reduce((sum, i: any) => sum + (Number(i.amount) || 0), 0);
    const totalExpenses = previousExpenses.reduce((sum, e: any) => sum + (Number(e.amount) || 0), 0);
    const closingBalance = totalIncome - totalExpenses;

    if (closingBalance > 0) {
      await this.createCarryForwardTransaction(currentMonth, previousMonth, closingBalance);
    }

    await this.markCarryForwardProcessed(uid, currentMonth);
  }

  private async createCarryForwardTransaction(
    currentMonth: string,
    previousMonth: string,
    amount: number
  ): Promise<void> {
    const [year, month] = previousMonth.split('-');
    const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    });

    await this.incomeService.addIncome({
      source: 'Carry Forward',
      amount,
      description: `Balance carried forward from ${monthName}`,
      date: this.getFirstDayOfMonth(currentMonth),
      month: currentMonth,
      isSystemGenerated: true,
      isCarryForward: true,
      createdAt: new Date(),
    });
  }

  private metadataRef(uid: string) {
    return doc(this.firestore, 'metadata', uid);
  }

  private async isCarryForwardProcessed(uid: string, month: string): Promise<boolean> {
    try {
      const snap = await getDoc(this.metadataRef(uid));
      return snap.exists() && snap.data()?.['processedMonths']?.[month] === true;
    } catch (err) {
      console.error('Error reading carry-forward metadata:', err);
      // Fail closed: if we can't confirm, don't risk creating a duplicate carry-forward.
      return true;
    }
  }

  private async markCarryForwardProcessed(uid: string, month: string): Promise<void> {
    try {
      await setDoc(
        this.metadataRef(uid),
        { processedMonths: { [month]: true }, lastUpdated: new Date() },
        { merge: true }
      );
    } catch (error) {
      console.error('Error marking carry-forward as processed:', error);
    }
  }

  private getPreviousMonth(currentMonth: string): string {
    const [year, month] = currentMonth.split('-').map(Number);
    const date = new Date(year, month - 1);
    date.setMonth(date.getMonth() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private getFirstDayOfMonth(month: string): Date {
    const [year, monthNum] = month.split('-').map(Number);
    return new Date(year, monthNum - 1, 1, 0, 0, 0);
  }

  /** Clears the "processed" flag for a month so carry-forward can run again. Not currently called by the UI. */
  async resetCarryForwardForMonth(month: string): Promise<void> {
    // Note: like the original, this does NOT delete the existing carry-forward income entry.
    const uid = this.auth.requireUid();
    await setDoc(
      this.metadataRef(uid),
      { processedMonths: { [month]: deleteField() }, lastUpdated: new Date() },
      { merge: true }
    );
  }
}
