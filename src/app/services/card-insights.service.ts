import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, distinctUntilChanged, map, shareReplay, switchMap } from 'rxjs';
import { CardsService } from './cards.service';
import { CardStatementsService } from './card-statements.service';
import { CardTransactionsService } from './card-transactions.service';
import { Card, CardPosition, cardPosition, positionWindowStart } from '../models/card.model';
import { CardStatement } from '../models/card-statement.model';
import { CardTransaction } from '../models/card-transaction.model';
import { fromDateInput, toDateInput } from '../utils/date-input.util';

export interface CardWithPosition {
  card: Card;
  pos: CardPosition;
  statements: CardStatement[];
  txns: CardTransaction[];
}

/**
 * Where every card stands: used / available limit, billed vs unbilled, cycle spend, rewards, fee
 * waiver. One place, so the dashboard, the Cards page, a card's own page and the notifications all
 * show the same numbers. Transactions are read in one range query (from the earliest date any card
 * needs, at most a year back plus statement anchors), using the existing userId + txnDate index.
 */
@Injectable({ providedIn: 'root' })
export class CardInsightsService {
  private cards = inject(CardsService);
  private statements = inject(CardStatementsService);
  private txns = inject(CardTransactionsService);

  private readonly base$ = combineLatest([this.cards.cards$, this.statements.statements$]).pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** The query window only changes when its start DAY changes, so edits don't restart the listener. */
  private readonly window$: Observable<CardTransaction[]> = this.base$.pipe(
    map(([cards, stmts]) => toDateInput(positionWindowStart(cards, stmts))),
    distinctUntilChanged(),
    switchMap(day => this.txns.since$(fromDateInput(day)!)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly positions$: Observable<CardWithPosition[]> = combineLatest([this.base$, this.window$]).pipe(
    map(([[cards, stmts], txns]) => {
      const today = new Date();
      return cards.map(card => ({
        card,
        pos: cardPosition(card, stmts, txns, today),
        statements: stmts.filter(s => s.cardId === card.id),
        txns: txns.filter(t => t.cardId === card.id),
      }));
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly byId$: Observable<Map<string, CardWithPosition>> = this.positions$.pipe(
    map(list => new Map(list.map(x => [x.card.id, x]))),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
