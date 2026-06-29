import { addDoc, collection, collectionData, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import { Firestore } from '@angular/fire/firestore';
import { Injectable, inject } from '@angular/core';
import { query, where } from "firebase/firestore";
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  firestore = inject(Firestore);
  authService = inject(AuthService);

  addExpense(data: any) {
    const userId = this.authService.getCurrentUserId();
    return addDoc(collection(this.firestore, 'expense'), { ...data, userId });
  }

  getExpenses() {
    const userId = this.authService.getCurrentUserId();
    if (!userId) {
      return collectionData(collection(this.firestore, 'expense'), {
        idField: 'id'
      });
    }
    return collectionData(
      query(
        collection(this.firestore, 'expense'),
        where('userId', '==', userId)
      ),
      { idField: 'id' }
    );
  }

  getExpensesByMonth(month: string) {
    const userId = this.authService.getCurrentUserId();
    if (!userId) {
      return collectionData(
        query(
          collection(this.firestore, 'expense'),
          where('month', '==', month)
        ),
        { idField: 'id' }
      );
    }
    return collectionData(
      query(
        collection(this.firestore, 'expense'),
        where('month', '==', month),
        where('userId', '==', userId)
      ),
      { idField: 'id' }
    );
  }

  updateExpense(expense: any) {
    const ref = doc(this.firestore, 'expense', expense.id);
    return updateDoc(ref, expense);
  }

  deleteExpense(id: string) {
    const ref = doc(this.firestore, 'expense', id);
    return deleteDoc(ref);
  }

  getAll() {
    return this.getExpenses();
  }
}
