import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, collectionData } from '@angular/fire/firestore';

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
}
