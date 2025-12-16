import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, collectionData, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import { query, where } from "firebase/firestore";

@Injectable({ providedIn: 'root' })
export class IncomeService {
  firestore = inject(Firestore);

  addIncome(data: any) {
    return addDoc(collection(this.firestore, 'income'), data);
  }

  getIncome() {
    return collectionData(collection(this.firestore, 'income'), {
      idField: 'id'
    });
  }

  getIncomeByMonth(month: string) {
    return collectionData(
      query(
        collection(this.firestore, 'income'),
        where('month', '==', month)
      ),
      { idField: 'id' }
    );
  }

  updateIncome(income: any) {
    const ref = doc(this.firestore, 'income', income.id);
    return updateDoc(ref, income);
  }

  deleteIncome(id: string) {
    const ref = doc(this.firestore, 'income', id);
    return deleteDoc(ref);
  }

}
