import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { CardsService } from '../../../services/cards.service';
import { CardStatementsService } from '../../../services/card-statements.service';
import { Card, cardLabel } from '../../../models/card.model';
import { CardStatement, dueInfo } from '../../../models/card-statement.model';
import { StatementFormComponent, StatementFormData } from '../../../dialogs/statement-form/statement-form.component';
import { UndoService } from '../../../services/undo.service';
import { VisiblePipe } from '../../../pipes/visible.pipe';

type StatusFilter = 'open' | 'all' | 'Paid';

@Component({
  selector: 'app-card-statements',
  standalone: true,
  imports: [DatePipe, DecimalPipe, VisiblePipe],
  templateUrl: './statements.component.html',
  styleUrl: './statements.component.scss',
})
export class StatementsComponent {
  private cardsService = inject(CardsService);
  private statementsService = inject(CardStatementsService);
  private dialog = inject(MatDialog);
  private undo = inject(UndoService);

  cards = toSignal(this.cardsService.cards$, { initialValue: [] as Card[] });
  private raw = toSignal(this.statementsService.statements$);
  loading = computed(() => this.raw() === undefined);

  statusFilter = signal<StatusFilter>('open');
  cardFilter = signal('all');
  confirmDeleteId = signal<string | null>(null);
  actionError = signal('');

  private cardMap = computed(() => new Map(this.cards().map(c => [c.id, c])));

  rows = computed(() =>
    (this.raw() ?? [])
      .filter(s => this.cardFilter() === 'all' || s.cardId === this.cardFilter())
      .filter(s =>
        this.statusFilter() === 'all' ? true : this.statusFilter() === 'Paid' ? s.status === 'Paid' : s.status !== 'Paid'
      )
      .map(s => ({ ...s, due: dueInfo(s) }))
      .sort((a, b) =>
        this.statusFilter() === 'open'
          ? a.dueDate.getTime() - b.dueDate.getTime()
          : b.statementDate.getTime() - a.statementDate.getTime()
      )
  );

  counts = computed(() => {
    const all = this.raw() ?? [];
    return { open: all.filter(s => s.status !== 'Paid').length, Paid: all.filter(s => s.status === 'Paid').length, all: all.length };
  });

  cardName(id: string): string {
    const c = this.cardMap().get(id);
    return c ? cardLabel(c) : 'Deleted card';
  }

  add(): void {
    this.open({ cards: this.cards(), cardId: this.cardFilter() === 'all' ? undefined : this.cardFilter() });
  }

  edit(statement: CardStatement): void {
    this.open({ cards: this.cards(), statement });
  }

  async markPaid(s: CardStatement): Promise<void> {
    try {
      await this.statementsService.markPaid(s);
      this.undo.offer(`Statement marked paid · ${this.cardName(s.cardId)}`, () => this.statementsService.restorePayment(s));
    } catch (err) {
      console.error(err);
      this.actionError.set('Could not mark the statement as paid.');
    }
  }

  remove(s: CardStatement): void {
    this.undo.defer(`Deleted statement · ${this.cardName(s.cardId)}`, [s.id], () => this.statementsService.delete(s.id));
  }

  private open(data: StatementFormData): void {
    this.dialog.open<StatementFormComponent, StatementFormData>(StatementFormComponent, {
      width: 'min(94vw, 560px)',
      maxWidth: '96vw',
      autoFocus: 'first-tabbable',
      data,
    });
  }
}
