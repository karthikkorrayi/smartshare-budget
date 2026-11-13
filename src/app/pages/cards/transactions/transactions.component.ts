import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { switchMap } from 'rxjs';
import { CardsService } from '../../../services/cards.service';
import { CardTransactionsService } from '../../../services/card-transactions.service';
import { Card, cardLabel } from '../../../models/card.model';
import { CardTransaction } from '../../../models/card-transaction.model';
import { TransactionFormComponent, TransactionFormData } from '../../../dialogs/transaction-form/transaction-form.component';
import { monthKey, toDateInput } from '../../../utils/date-input.util';
import { UndoService } from '../../../services/undo.service';
import { VisiblePipe } from '../../../pipes/visible.pipe';
import { IconComponent } from '../../../ui/icon.component';

interface DayGroup {
  key: string;
  date: Date;
  items: CardTransaction[];
  spent: number;
}

@Component({
  selector: 'app-card-transactions',
  standalone: true,
  imports: [IconComponent, DatePipe, DecimalPipe, VisiblePipe],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
})
export class TransactionsComponent {
  private cardsService = inject(CardsService);
  private txnService = inject(CardTransactionsService);
  private dialog = inject(MatDialog);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private undo = inject(UndoService);

  month = signal(monthKey());
  cardFilter = signal<string>(this.route.snapshot.queryParamMap.get('card') ?? 'all');
  sourceFilter = signal<'all' | 'manual' | 'auto'>('all');
  confirmDeleteId = signal<string | null>(null);
  actionError = signal('');

  cards = toSignal(this.cardsService.cards$, { initialValue: [] as Card[] });
  private raw = toSignal(toObservable(this.month).pipe(switchMap(m => this.txnService.byMonth$(m))));
  loading = computed(() => this.raw() === undefined);

  private cardMap = computed(() => new Map(this.cards().map(c => [c.id, c])));

  filtered = computed(() =>
    (this.raw() ?? []).filter(
      t =>
        (this.cardFilter() === 'all' || t.cardId === this.cardFilter()) &&
        (this.sourceFilter() === 'all' ||
          (this.sourceFilter() === 'manual' ? t.source === 'manual' : t.source !== 'manual'))
    )
  );

  groups = computed<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>();
    for (const t of this.filtered()) {
      const key = toDateInput(t.txnDate);
      const g = map.get(key) ?? { key, date: t.txnDate, items: [], spent: 0 };
      g.items.push(t);
      if (t.direction === 'debit') g.spent += t.amount;
      map.set(key, g);
    }
    return [...map.values()];
  });

  totals = computed(() => {
    const list = this.filtered();
    return {
      count: list.length,
      spent: list.filter(t => t.direction === 'debit').reduce((s, t) => s + t.amount, 0),
      credits: list.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0),
      refunds: list.filter(t => t.direction === 'credit' && t.category === 'Refund').reduce((s, t) => s + t.amount, 0),
      auto: list.filter(t => t.source !== 'manual').length,
    };
  });

  cardName(id: string): string {
    const c = this.cardMap().get(id);
    return c ? cardLabel(c) : 'Deleted card';
  }

  setCard(id: string): void {
    this.cardFilter.set(id);
    this.router.navigate([], { queryParams: { card: id === 'all' ? null : id }, replaceUrl: true });
  }

  shiftMonth(delta: number): void {
    const [y, m] = this.month().split('-').map(Number);
    this.month.set(monthKey(new Date(y, m - 1 + delta, 1)));
  }

  add(): void {
    this.dialog.open<TransactionFormComponent, TransactionFormData>(TransactionFormComponent, {
      width: 'min(94vw, 520px)',
      maxWidth: '96vw',
      autoFocus: 'first-tabbable',
      data: { cards: this.cards(), cardId: this.cardFilter() === 'all' ? undefined : this.cardFilter() },
    });
  }

  edit(txn: CardTransaction): void {
    this.dialog.open<TransactionFormComponent, TransactionFormData>(TransactionFormComponent, {
      width: 'min(94vw, 520px)',
      maxWidth: '96vw',
      data: { cards: this.cards(), txn },
    });
  }

  remove(t: CardTransaction): void {
    this.undo.defer(`Deleted "${t.description}" · ₹${t.amount}`, [t.id], () => this.txnService.delete(t.id));
  }
}
