import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Card, cardLabel } from '../../models/card.model';
import { CardTransaction, TXN_CATEGORIES, TxnDirection } from '../../models/card-transaction.model';
import { CardTransactionsService } from '../../services/card-transactions.service';
import { fromDateInput, toDateInput } from '../../utils/date-input.util';

export interface TransactionFormData {
  cards: Card[];
  txn?: CardTransaction;
  cardId?: string;
}

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './transaction-form.component.html',
})
export class TransactionFormComponent {
  private dialogRef = inject(MatDialogRef<TransactionFormComponent>);
  private txns = inject(CardTransactionsService);
  data: TransactionFormData = inject(MAT_DIALOG_DATA);

  readonly categories = TXN_CATEGORIES;
  readonly label = cardLabel;
  isEdit = !!this.data.txn;
  saving = signal(false);
  errors = signal<string[]>([]);

  form = {
    cardId: this.data.txn?.cardId ?? this.data.cardId ?? this.data.cards.find(c => c.status === 'Active')?.id ?? '',
    txnDate: toDateInput(this.data.txn?.txnDate ?? new Date()),
    amount: this.data.txn?.amount ?? (null as number | null),
    direction: (this.data.txn?.direction ?? 'debit') as TxnDirection,
    description: this.data.txn?.description ?? '',
    category: this.data.txn?.category ?? 'Others',
  };

  close(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    const f = this.form;
    const out: string[] = [];
    if (!f.cardId) out.push('Choose a card.');
    if (!fromDateInput(f.txnDate)) out.push('Pick the transaction date.');
    if (!(Number(f.amount) > 0)) out.push('Amount must be more than 0.');
    if (!f.description.trim()) out.push('Add a description (merchant or purpose).');
    this.errors.set(out);
    if (out.length) return;

    const input = {
      cardId: f.cardId,
      txnDate: fromDateInput(f.txnDate)!,
      amount: Number(f.amount),
      direction: f.direction,
      description: f.description,
      category: f.category,
    };
    this.saving.set(true);
    try {
      if (this.isEdit) await this.txns.update(this.data.txn!, input);
      else await this.txns.add(input);
      this.dialogRef.close(true);
    } catch (err: any) {
      console.error('[TransactionForm] save failed', err);
      this.errors.set(['Could not save the transaction. Check the values and your connection.']);
    } finally {
      this.saving.set(false);
    }
  }
}
