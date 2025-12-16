import { addDoc, collection, collectionData } from '@angular/fire/firestore';
import { Firestore } from '@angular/fire/firestore';
import { Injectable, inject } from '@angular/core';
import { query, where } from "firebase/firestore";

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  firestore = inject(Firestore);

  addExpense(data: any) {
    return addDoc(collection(this.firestore, 'expenses'), data);
  }

  getExpenses() {
    return collectionData(collection(this.firestore, 'expenses'), {
      idField: 'id'
    });
  }

  getExpensesByMonth(month: string) {
  return collectionData(
    query(
      collection(this.firestore, 'expenses'),
      where('month', '==', month)
    ),
    { idField: 'id' }
  );
}

}

