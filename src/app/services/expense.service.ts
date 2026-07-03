import { addDoc, collection, collectionData, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import { Firestore } from '@angular/fire/firestore';
import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { query, where } from "firebase/firestore";

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  firestore = inject(Firestore);
  private auth = inject(AuthService);

  addExpense(data: any) {
    return addDoc(collection(this.firestore, 'expenses'), { ...data, userId: this.auth.user()?.uid });
  }

  getExpenses() {
    return collectionData(query(collection(this.firestore, 'expenses'), where('userId', '==', this.auth.user()?.uid ?? '__anonymous__')), {
      idField: 'id'
    });
  }

  getExpensesByMonth(month: string) {
    return collectionData(
      query(
        collection(this.firestore, 'expenses'),
        where('month', '==', month),
        where('userId', '==', this.auth.user()?.uid ?? '__anonymous__')
      ),
      { idField: 'id' }
    );
  }

  updateExpense(expense: any) {
    const ref = doc(this.firestore, 'expenses', expense.id);
    return updateDoc(ref, expense);
  }

  deleteExpense(id: string) {
    const ref = doc(this.firestore, 'expenses', id);
    return deleteDoc(ref);
  }

}