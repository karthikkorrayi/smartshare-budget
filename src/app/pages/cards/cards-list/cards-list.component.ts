import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { CardsService } from '../../../services/cards.service';
import { CardStatementsService } from '../../../services/card-statements.service';
import { Card, expiryInfo, nextDueDate, nextStatementDate } from '../../../models/card.model';
import { CardStatement, dueInfo } from '../../../models/card-statement.model';
import { CardFormComponent, CardFormData } from '../../../dialogs/card-form/card-form.component';
import { TransactionFormComponent, TransactionFormData } from '../../../dialogs/transaction-form/transaction-form.component';
import { StatementFormComponent, StatementFormData } from '../../../dialogs/statement-form/statement-form.component';
import { daysBetween, relativeDays } from '../../../utils/date-input.util';

interface CardView extends Card {
  expiry: ReturnType<typeof expiryInfo>;
  nextStatement: Date;
  nextStatementIn: string;
  latest: CardStatement | null;
  latestDue: ReturnType<typeof dueInfo> | null;
  nextDue: Date;
  nextDueIn: string;
}

const DIALOG = { width: 'min(94vw, 560px)', maxWidth: '96vw', autoFocus: 'first-tabbable' as const };

@Component({
  selector: 'app-cards-list',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './cards-list.component.html',
  styleUrl: './cards-list.component.scss',
})
export class CardsListComponent {
  private cardsService = inject(CardsService);
  private statementsService = inject(CardStatementsService);
  private dialog = inject(MatDialog);

  private rawCards = toSignal(this.cardsService.cards$);
  private statements = toSignal(this.statementsService.statements$, { initialValue: [] as CardStatement[] });

  loading = computed(() => this.rawCards() === undefined);
  showClosed = signal(false);
  confirmDeleteId = signal<string | null>(null);
  deleting = signal(false);
  actionError = signal('');

  cards = computed<CardView[]>(() => {
    const today = new Date();
    return (this.rawCards() ?? []).map(c => {
      const latest = this.statements().find(s => s.cardId === c.id) ?? null; // statements are newest-first
      const nextStatement = nextStatementDate(c, today);
      const nextDue = latest && latest.status !== 'Paid' ? latest.dueDate : nextDueDate(c, today);
      return {
        ...c,
        expiry: expiryInfo(c, today),
        nextStatement,
        nextStatementIn: relativeDays(daysBetween(today, nextStatement)),
        latest,
        latestDue: latest ? dueInfo(latest, today) : null,
        nextDue,
        nextDueIn: relativeDays(daysBetween(today, nextDue)),
      };
    });
  });

  visible = computed(() => this.cards().filter(c => this.showClosed() || c.status === 'Active'));
  closedCount = computed(() => this.cards().filter(c => c.status === 'Closed').length);

  summary = computed(() => {
    const active = this.cards().filter(c => c.status === 'Active');
    const unpaid = this.statements().filter(s => s.status !== 'Paid' && active.some(c => c.id === s.cardId));
    return {
      active: active.length,
      outstanding: unpaid.reduce((sum, s) => sum + Math.max(0, s.totalDue - s.paidAmount), 0),
      dueSoon: unpaid.filter(s => dueInfo(s).tone !== 'ok').length,
      monitored: active.filter(c => c.autoMonitor).length,
    };
  });

  addCard(): void {
    this.dialog.open<CardFormComponent, CardFormData>(CardFormComponent, { ...DIALOG, data: {} });
  }

  editCard(card: Card): void {
    this.dialog.open<CardFormComponent, CardFormData>(CardFormComponent, { ...DIALOG, data: { card } });
  }

  addTransaction(card: Card): void {
    this.dialog.open<TransactionFormComponent, TransactionFormData>(TransactionFormComponent, {
      ...DIALOG,
      data: { cards: this.rawCards() ?? [], cardId: card.id },
    });
  }

  addStatement(card: Card): void {
    this.dialog.open<StatementFormComponent, StatementFormData>(StatementFormComponent, {
      ...DIALOG,
      data: { cards: this.rawCards() ?? [], cardId: card.id },
    });
  }

  async markPaid(s: CardStatement): Promise<void> {
    try {
      await this.statementsService.markPaid(s);
    } catch (err) {
      console.error(err);
      this.actionError.set('Could not mark the statement as paid.');
    }
  }

  askDelete(id: string): void {
    this.actionError.set('');
    this.confirmDeleteId.set(id);
  }

  async confirmDelete(id: string): Promise<void> {
    this.deleting.set(true);
    try {
      await this.cardsService.deleteWithHistory(id);
    } catch (err) {
      console.error('[CardsList] delete failed', err);
      this.actionError.set('Could not delete the card. Please try again.');
    } finally {
      this.deleting.set(false);
      this.confirmDeleteId.set(null);
    }
  }
}
