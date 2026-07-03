import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Firestore, collection, addDoc, collectionData, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import { query, where } from "firebase/firestore";

@Injectable({ providedIn: 'root' })
export class IncomeService {
  firestore = inject(Firestore);
  private auth = inject(AuthService);

  addIncome(data: any) {
    return addDoc(collection(this.firestore, 'income'), { ...data, userId: this.auth.user()?.uid });
  }

  getIncome() {
    return collectionData(query(collection(this.firestore, 'income'), where('userId', '==', this.auth.user()?.uid ?? '__anonymous__')), {
      idField: 'id'
    });
  }

  getIncomeByMonth(month: string) {
    return collectionData(
      query(
        collection(this.firestore, 'income'),
        where('month', '==', month),
        where('userId', '==', this.auth.user()?.uid ?? '__anonymous__')
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