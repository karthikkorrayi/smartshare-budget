import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  WALLET_CATEGORIES,
  WALLET_TXN_INFO,
  WALLET_TXN_TYPES,
  Wallet,
  WalletTransaction,
  WalletTxnInput,
  WalletTxnType,
  walletLabel,
} from '../../models/wallet.model';
import { WalletsService } from '../../services/wallets.service';
import { UndoService } from '../../services/undo.service';
import { fromDateInput, toDateInput } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';

export interface WalletTxnFormData {
  wallets: Wallet[];
  txn?: WalletTransaction;
  walletId?: string;
  type?: WalletTxnType;
}

@Component({
  selector: 'app-wallet-txn-form',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="cc-dialog">
      <div class="cc-dialog-head">
        <span class="icon" aria-hidden="true"><app-icon [name]="form.type === 'spend' ? 'shopping-cart' : form.type === 'topup' ? 'plus' : form.type === 'refund' ? 'undo2' : 'gift'" [size]="22" /></span>
        <div>
          <h2>{{ isEdit ? 'Edit wallet entry' : 'Record wallet ' + info[form.type].label.toLowerCase() }}</h2>
          <p>{{ info[form.type].counts }}.</p>
        </div>
      </div>

      <form class="cc-dialog-body" (ngSubmit)="save()" novalidate>
        <div class="cc-chips types" role="radiogroup" aria-label="Entry type">
          @for (t of types; track t) {
            <button type="button" class="cc-chip" role="radio" [attr.aria-checked]="form.type === t" [class.active]="form.type === t" (click)="form.type = t">
              {{ info[t].label }}
            </button>
          }
        </div>

        <label class="cc-field">
          <span>Wallet</span>
          <select name="walletId" [(ngModel)]="form.walletId">
            @for (w of data.wallets; track w.id) {
              <option [value]="w.id">{{ label(w) }}{{ w.status === 'Closed' ? ' (closed)' : '' }}</option>
            }
          </select>
        </label>

        <div class="cc-row">
          <label class="cc-field">
            <span>Date</span>
            <input name="date" type="date" [(ngModel)]="form.date" />
          </label>
          <label class="cc-field">
            <span>Amount (₹)</span>
            <input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" [(ngModel)]="form.amount" />
          </label>
        </div>

        <div class="cc-row">
          <label class="cc-field">
            <span>{{ form.type === 'topup' ? 'From' : form.type === 'cashback' ? 'Offer' : 'Description' }}</span>
            <input name="description" maxlength="120" [placeholder]="placeholder()" [(ngModel)]="form.description" />
          </label>
          @if (form.type === 'spend' || form.type === 'refund') {
            <label class="cc-field">
              <span>Category</span>
              <select name="category" [(ngModel)]="form.category">
                @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
              </select>
            </label>
          }
        </div>

        @if (errors().length) {
          <ul class="cc-errors" role="alert">
            @for (e of errors(); track e) { <li>{{ e }}</li> }
          </ul>
        }

        <div class="cc-dialog-actions">
          <button type="button" class="cc-btn" (click)="close()" [disabled]="saving()">Cancel</button>
          <button type="submit" class="cc-btn cc-btn--primary" [disabled]="saving()">
            {{ saving() ? 'Saving…' : isEdit ? 'Update' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`.types { margin-bottom: 14px; }`],
})
export class WalletTxnFormComponent {
  private dialogRef = inject(MatDialogRef<WalletTxnFormComponent>);
  private wallets = inject(WalletsService);
  private undo = inject(UndoService);
  data: WalletTxnFormData = inject(MAT_DIALOG_DATA);

  readonly types = WALLET_TXN_TYPES;
  readonly info = WALLET_TXN_INFO;
  readonly categories = WALLET_CATEGORIES;
  readonly label = walletLabel;
  isEdit = !!this.data.txn;
  saving = signal(false);
  errors = signal<string[]>([]);

  form = {
    walletId: this.data.txn?.walletId ?? this.data.walletId ?? this.data.wallets.find(w => w.status === 'Active')?.id ?? '',
    type: (this.data.txn?.type ?? this.data.type ?? 'spend') as WalletTxnType,
    date: toDateInput(this.data.txn?.date ?? new Date()),
    amount: this.data.txn?.amount ?? (null as number | null),
    description: this.data.txn?.description ?? '',
    category: this.data.txn?.category || 'Others',
  };

  placeholder(): string {
    switch (this.form.type) {
      case 'topup': return 'e.g. HDFC savings, ATM, UPI from bank';
      case 'cashback': return 'e.g. Recharge cashback';
      case 'refund': return 'e.g. Cancelled order';
      default: return 'Merchant or purpose';
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    const f = this.form;
    const out: string[] = [];
    if (!f.walletId) out.push('Choose a wallet.');
    const date = fromDateInput(f.date);
    if (!date) out.push('Pick the date.');
    if (!(Number(f.amount) > 0)) out.push('Amount must be more than 0.');
    this.errors.set(out);
    if (out.length) return;

    const input: WalletTxnInput = {
      walletId: f.walletId,
      type: f.type,
      amount: Number(f.amount),
      date: date!,
      description: f.description.trim() || this.info[f.type].label,
      category: f.category,
    };
    this.saving.set(true);
    try {
      if (this.isEdit) {
        const b = this.data.txn!;
        await this.wallets.updateTxn(b.id, input);
        this.undo.offer(`Updated "${input.description}"`, () => this.wallets.updateTxn(b.id, b));
      } else {
        const ref = await this.wallets.addTxn(input);
        this.undo.offer(`${this.info[input.type].label} ₹${input.amount} recorded`, () => this.wallets.deleteTxn(ref.id));
      }
      this.dialogRef.close(true);
    } catch (err) {
      console.error('[WalletTxnForm] save failed', err);
      this.errors.set(['Could not save. Check the values and your connection.']);
    } finally {
      this.saving.set(false);
    }
  }
}
