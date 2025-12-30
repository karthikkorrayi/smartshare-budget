import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, collectionData, query, where, getDocs, doc, setDoc } from '@angular/fire/firestore';
import { IncomeService } from './income.service';
import { ExpenseService } from './expense.service';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CarryForwardService {
  private firestore = inject(Firestore);
  private incomeService = inject(IncomeService);
  private expenseService = inject(ExpenseService);

  private readonly METADATA_DOC = 'carry_forward_metadata';

  async checkAndProcessCarryForward(currentMonth: string): Promise<void> {
    const previousMonth = this.getPreviousMonth(currentMonth);

    const alreadyProcessed = await this.isCarryForwardProcessed(currentMonth);
    if (alreadyProcessed) {
      return;
    }

    const previousIncome = await firstValueFrom(
      this.incomeService.getIncomeByMonth(previousMonth)
    );
    const previousExpenses = await firstValueFrom(
      this.expenseService.getExpensesByMonth(previousMonth)
    );

    const totalIncome = previousIncome.reduce((sum, i: any) => sum + i.amount, 0);
    const totalExpenses = previousExpenses.reduce((sum, e: any) => sum + e.amount, 0);
    const closingBalance = totalIncome - totalExpenses;

    if (closingBalance > 0) {
      await this.createCarryForwardTransaction(
        currentMonth,
        previousMonth,
        closingBalance
      );
    }

    await this.markCarryForwardProcessed(currentMonth);
  }

  private async createCarryForwardTransaction(
    currentMonth: string,
    previousMonth: string,
    amount: number
  ): Promise<void> {
    const [year, month] = previousMonth.split('-');
    const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', {
      month: 'long',
      year: 'numeric'
    });

    const firstDayOfMonth = this.getFirstDayOfMonth(currentMonth);

    await addDoc(collection(this.firestore, 'income'), {
      source: 'Carry Forward',
      amount: amount,
      description: `Balance carried forward from ${monthName}`,
      date: firstDayOfMonth,
      month: currentMonth,
      isSystemGenerated: true,
      isCarryForward: true,
      createdAt: new Date()
    });
  }

  private async isCarryForwardProcessed(month: string): Promise<boolean> {
    try {
      const metadataRef = doc(this.firestore, 'metadata', this.METADATA_DOC);
      const metadataQuery = await getDocs(
        query(collection(this.firestore, 'metadata'), where('__name__', '==', this.METADATA_DOC))
      );

      if (metadataQuery.empty) {
        return false;
      }

      const data = metadataQuery.docs[0].data();
      return data['processedMonths']?.[month] === true;
    } catch {
      return false;
    }
  }

  private async markCarryForwardProcessed(month: string): Promise<void> {
    const metadataRef = doc(this.firestore, 'metadata', this.METADATA_DOC);

    try {
      const metadataQuery = await getDocs(
        query(collection(this.firestore, 'metadata'), where('__name__', '==', this.METADATA_DOC))
      );

      let processedMonths: any = {};

      if (!metadataQuery.empty) {
        processedMonths = metadataQuery.docs[0].data()['processedMonths'] || {};
      }

      processedMonths[month] = true;

      await setDoc(metadataRef, {
        processedMonths,
        lastUpdated: new Date()
      });
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

  async resetCarryForwardForMonth(month: string): Promise<void> {
    const carryForwardQuery = query(
      collection(this.firestore, 'income'),
      where('month', '==', month),
      where('isCarryForward', '==', true)
    );

    const snapshot = await getDocs(carryForwardQuery);

    const metadataRef = doc(this.firestore, 'metadata', this.METADATA_DOC);
    const metadataSnapshot = await getDocs(
      query(collection(this.firestore, 'metadata'), where('__name__', '==', this.METADATA_DOC))
    );

    if (!metadataSnapshot.empty) {
      const processedMonths = metadataSnapshot.docs[0].data()['processedMonths'] || {};
      delete processedMonths[month];

      await setDoc(metadataRef, {
        processedMonths,
        lastUpdated: new Date()
      });
    }
  }
}
