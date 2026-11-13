import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Card, CardInput } from '../../models/card.model';
import { CardsService } from '../../services/cards.service';
import { UndoService } from '../../services/undo.service';
import { IconComponent } from '../../ui/icon.component';

export interface CardFormData {
  card?: Card;
}

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

@Component({
  selector: 'app-card-form',
  standalone: true,
  imports: [IconComponent, FormsModule],
  templateUrl: './card-form.component.html',
})
export class CardFormComponent {
  private dialogRef = inject(MatDialogRef<CardFormComponent>);
  private cards = inject(CardsService);
  private undo = inject(UndoService);
  data: CardFormData = inject(MAT_DIALOG_DATA, { optional: true }) ?? {};

  readonly months = MONTHS;
  readonly years = Array.from({ length: 16 }, (_, i) => new Date().getFullYear() - 3 + i);
  readonly days = Array.from({ length: 31 }, (_, i) => i + 1);

  isEdit = !!this.data.card;
  saving = signal(false);
  errors = signal<string[]>([]);

  form: CardInput = {
    cardholderName: this.data.card?.cardholderName ?? '',
    bankName: this.data.card?.bankName ?? '',
    nickname: this.data.card?.nickname ?? '',
    lastFourDigits: this.data.card?.lastFourDigits ?? '',
    expiryMonth: this.data.card?.expiryMonth ?? 0,
    expiryYear: this.data.card?.expiryYear ?? 0,
    statementDay: this.data.card?.statementDay ?? 0,
    dueDay: this.data.card?.dueDay ?? 0,
    status: this.data.card?.status ?? 'Active',
    dailySpendingLimit: this.data.card?.dailySpendingLimit ?? 0,
  };

  /** Digits only, keeps the LAST four — pasting a full number can't store it. */
  onLastFour(value: string): void {
    this.form.lastFourDigits = (value ?? '').replace(/\D/g, '').slice(-4);
  }

  close(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    const problems = this.validate();
    this.errors.set(problems);
    if (problems.length) return;
    this.saving.set(true);
    try {
      if (this.isEdit) {
        const b = this.data.card!;
        await this.cards.update(b.id, this.form);
        this.undo.offer(`Updated card ••${b.lastFourDigits}`, () => this.cards.update(b.id, {
          cardholderName: b.cardholderName, bankName: b.bankName, nickname: b.nickname, lastFourDigits: b.lastFourDigits,
          expiryMonth: b.expiryMonth, expiryYear: b.expiryYear, statementDay: b.statementDay, dueDay: b.dueDay,
          status: b.status, dailySpendingLimit: b.dailySpendingLimit,
        }));
      } else {
        const ref = await this.cards.add(this.form);
        this.undo.offer(`Added card ••${this.form.lastFourDigits}`, () => this.cards.deleteWithHistory(ref.id));
      }
      this.dialogRef.close(true);
    } catch (err: any) {
      console.error('[CardForm] save failed', err);
      this.errors.set([
        err?.code === 'permission-denied'
          ? 'The server rejected these values. Check every field and try again.'
          : 'Could not save the card. Check your connection and try again.',
      ]);
    } finally {
      this.saving.set(false);
    }
  }

  private validate(): string[] {
    const f = this.form;
    const out: string[] = [];
    if (!f.cardholderName.trim()) out.push("Cardholder's name is required.");
    if (!f.bankName.trim()) out.push('Bank name is required.');
    if (!/^\d{4}$/.test(f.lastFourDigits)) out.push('Enter exactly the last 4 digits.');
    if (!Number(f.expiryMonth) || !Number(f.expiryYear)) out.push('Pick the card expiry month and year.');
    if (!Number(f.statementDay)) out.push('Pick the statement generation day.');
    if (!Number(f.dueDay)) out.push('Pick the payment due day.');
    if (!(Number(f.dailySpendingLimit) >= 0)) out.push('Daily limit cannot be negative.');
    return out;
  }
}
