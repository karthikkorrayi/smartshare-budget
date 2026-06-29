import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, collectionData, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import { query, where } from "firebase/firestore";
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class IncomeService {
  firestore = inject(Firestore);
  authService = inject(AuthService);

  addIncome(data: any) {
    const userId = this.authService.getCurrentUserId();
    return addDoc(collection(this.firestore, 'income'), { ...data, userId });
  }

  getIncome() {
    const userId = this.authService.getCurrentUserId();
    if (!userId) {
      return collectionData(collection(this.firestore, 'income'), {
        idField: 'id'
      });
    }
    return collectionData(
      query(
        collection(this.firestore, 'income'),
        where('userId', '==', userId)
      ),
      { idField: 'id' }
    );
  }

  getIncomeByMonth(month: string) {
    const userId = this.authService.getCurrentUserId();
    if (!userId) {
      return collectionData(
        query(
          collection(this.firestore, 'income'),
          where('month', '==', month)
        ),
        { idField: 'id' }
      );
    }
    return collectionData(
      query(
        collection(this.firestore, 'income'),
        where('month', '==', month),
        where('userId', '==', userId)
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

  getAll() {
    return this.getIncome();
  }
}
