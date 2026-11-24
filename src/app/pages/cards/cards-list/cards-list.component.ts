import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { CardsService } from '../../../services/cards.service';
import { CardStatementsService } from '../../../services/card-statements.service';
import { Card, CardPosition, NETWORK_LABEL, TIER_LABEL, billingCycle, expiryInfo, usageTone } from '../../../models/card.model';
import { CardInsightsService } from '../../../services/card-insights.service';
import { CardStatement, dueInfo } from '../../../models/card-statement.model';
import { CardFormComponent, CardFormData } from '../../../dialogs/card-form/card-form.component';
import { TransactionFormComponent, TransactionFormData } from '../../../dialogs/transaction-form/transaction-form.component';
import { StatementFormComponent, StatementFormData } from '../../../dialogs/statement-form/statement-form.component';
import { daysBetween, relativeDays } from '../../../utils/date-input.util';
import { UndoService } from '../../../services/undo.service';
import { VisiblePipe } from '../../../pipes/visible.pipe';
import { IconComponent } from '../../../ui/icon.component';
import { AmountComponent } from '../../../ui/amount.component';

interface CardView extends Card {
  pos: CardPosition | null;
  tone: string;
  freeDays: number;
  expiry: ReturnType<typeof expiryInfo>;
  nextStatement: Date;
  nextStatementIn: string;
  latest: CardStatement | null;
  latestDue: ReturnType<typeof dueInfo> | null;
  nextDue: Date;
  nextDueIn: string;
}

const DIALOG = { width: 'min(96vw, 600px)', maxWidth: '96vw', autoFocus: 'first-tabbable' as const };

@Component({
  selector: 'app-cards-list',
  standalone: true,
  imports: [IconComponent, DatePipe, DecimalPipe, RouterLink, VisiblePipe, AmountComponent],
  templateUrl: './cards-list.component.html',
  styleUrl: './cards-list.component.scss',
})
export class CardsListComponent {
  private cardsService = inject(CardsService);
  private statementsService = inject(CardStatementsService);
  private insights = inject(CardInsightsService);
  private positions = toSignal(this.insights.byId$);
  readonly networkLabel = NETWORK_LABEL;
  readonly tierLabel = TIER_LABEL;
  private dialog = inject(MatDialog);
  private undo = inject(UndoService);

  private rawCards = toSignal(this.cardsService.cards$);
  private statements = toSignal(this.statementsService.statements$, { initialValue: [] as CardStatement[] });

  loading = computed(() => this.rawCards() === undefined);
  showClosed = signal(false);
  confirmDeleteId = signal<string | null>(null);
  deleting = signal(false);
  actionError = signal('');

  cards = computed<CardView[]>(() => {
    const today = new Date();
    const posMap = this.positions();
    return (this.rawCards() ?? []).map(c => {
      const latest = this.statements().find(s => s.cardId === c.id) ?? null; // statements are newest-first
      const cyc = billingCycle(c, today);
      const nextDue = latest && latest.status !== 'Paid' ? latest.dueDate : cyc.nextDue;
      const pos = posMap?.get(c.id)?.pos ?? null;
      return {
        ...c,
        pos,
        tone: usageTone(pos?.usedPct ?? null),
        freeDays: cyc.freeDays,
        expiry: expiryInfo(c, today),
        nextStatement: cyc.nextStatement,
        nextStatementIn: relativeDays(daysBetween(today, cyc.nextStatement)),
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
    const withLimit = active.filter(c => c.pos && c.pos.limit > 0);
    const limit = withLimit.reduce((s, c) => s + c.pos!.limit, 0);
    const usedOnLimited = withLimit.reduce((s, c) => s + c.pos!.used, 0);
    return {
      active: active.length,
      /** What you owe across cards right now (billed + unbilled). */
      owed: active.reduce((s, c) => s + (c.pos?.used ?? 0), 0),
      available: withLimit.reduce((s, c) => s + (c.pos!.available ?? 0), 0),
      limit,
      usedPct: limit > 0 ? Math.round((usedOnLimited / limit) * 100) : null,
      dueSoon: unpaid.filter(s => dueInfo(s).tone !== 'ok').length,
      unpaid: unpaid.length,
    };
  });

  meterWidth(c: CardView, part: 'billed' | 'unbilled'): number {
    const p = c.pos;
    if (!p || !p.limit) return 0;
    return Math.max(0, Math.min(100, (p[part] / p.limit) * 100));
  }

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
      this.undo.offer('Statement marked paid', () => this.statementsService.restorePayment(s));
    } catch (err) {
      console.error(err);
      this.actionError.set('Could not mark the statement as paid.');
    }
  }

  askDelete(id: string): void {
    this.actionError.set('');
    this.confirmDeleteId.set(id);
  }

  /** Card + its transactions and statements are removed after 5 s; Undo cancels. */
  confirmDelete(c: Card): void {
    this.confirmDeleteId.set(null);
    this.undo.defer(`Deleted card ${c.nickname || c.bankName} ••${c.lastFourDigits} and its history`, [c.id], () => this.cardsService.deleteWithHistory(c.id));
  }
}
