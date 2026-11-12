import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Card, cardLabel } from '../../models/card.model';
import { CardStatement, StatementStatus, statusFromPaid } from '../../models/card-statement.model';
import { CardStatementsService } from '../../services/card-statements.service';
import { dayInMonth, fromDateInput, toDateInput } from '../../utils/date-input.util';
import { UndoService } from '../../services/undo.service';

export interface StatementFormData {
  cards: Card[];
  statement?: CardStatement;
  cardId?: string;
}

@Component({
  selector: 'app-statement-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './statement-form.component.html',
})
export class StatementFormComponent {
  private dialogRef = inject(MatDialogRef<StatementFormComponent>);
  private statements = inject(CardStatementsService);
  private undo = inject(UndoService);
  data: StatementFormData = inject(MAT_DIALOG_DATA);

  readonly label = cardLabel;
  isEdit = !!this.data.statement;
  saving = signal(false);
  errors = signal<string[]>([]);

  form = {
    cardId: this.data.statement?.cardId ?? this.data.cardId ?? this.data.cards.find(c => c.status === 'Active')?.id ?? '',
    statementDate: toDateInput(this.data.statement?.statementDate),
    dueDate: toDateInput(this.data.statement?.dueDate),
    totalDue: this.data.statement?.totalDue ?? (null as number | null),
    minDue: this.data.statement?.minDue ?? (null as number | null),
    paidAmount: this.data.statement?.paidAmount ?? 0,
  };

  constructor() {
    if (!this.isEdit) this.prefillDates();
  }

  /** Pre-fills the latest cycle from the card's statement/due days. */
  prefillDates(): void {
    const card = this.data.cards.find(c => c.id === this.form.cardId);
    if (!card) return;
    const now = new Date();
    const inThisMonth = dayInMonth(now.getFullYear(), now.getMonth(), card.statementDay);
    const stmt = inThisMonth <= now ? inThisMonth : dayInMonth(now.getFullYear(), now.getMonth() - 1, card.statementDay);
    const dueSameMonth = dayInMonth(stmt.getFullYear(), stmt.getMonth(), card.dueDay);
    const due = dueSameMonth > stmt ? dueSameMonth : dayInMonth(stmt.getFullYear(), stmt.getMonth() + 1, card.dueDay);
    this.form.statementDate = toDateInput(stmt);
    this.form.dueDate = toDateInput(due);
  }

  get derivedStatus(): StatementStatus {
    return statusFromPaid(Number(this.form.totalDue) || 0, Number(this.form.paidAmount) || 0);
  }

  close(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    const f = this.form;
    const stmt = fromDateInput(f.statementDate);
    const due = fromDateInput(f.dueDate);
    const out: string[] = [];
    if (!f.cardId) out.push('Choose a card.');
    if (!stmt) out.push('Pick the statement date.');
    if (!due) out.push('Pick the payment due date.');
    if (stmt && due && due < stmt) out.push('Due date cannot be before the statement date.');
    if (!(Number(f.totalDue) >= 0) || f.totalDue === null) out.push('Enter the total amount due.');
    if (!(Number(f.minDue) >= 0) || f.minDue === null) out.push('Enter the minimum amount due.');
    if (Number(f.minDue) > Number(f.totalDue)) out.push('Minimum due cannot exceed total due.');
    if (!(Number(f.paidAmount) >= 0)) out.push('Paid amount cannot be negative.');
    this.errors.set(out);
    if (out.length) return;

    const input = {
      cardId: f.cardId,
      statementDate: stmt!,
      dueDate: due!,
      totalDue: Number(f.totalDue),
      minDue: Number(f.minDue),
      paidAmount: Number(f.paidAmount) || 0,
      status: this.derivedStatus,
    };
    this.saving.set(true);
    try {
      if (this.isEdit) {
        const b = this.data.statement!;
        await this.statements.update(b.id, input);
        this.undo.offer('Statement updated', () => this.statements.update(b.id, b));
      } else {
        const ref = await this.statements.add(input);
        this.undo.offer('Statement added', () => this.statements.delete(ref.id));
      }
      this.dialogRef.close(true);
    } catch (err: any) {
      console.error('[StatementForm] save failed', err);
      this.errors.set(['Could not save the statement. Check the values and your connection.']);
    } finally {
      this.saving.set(false);
    }
  }
}
