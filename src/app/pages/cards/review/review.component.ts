import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ReviewService } from '../../../services/review.service';
import { CardsService } from '../../../services/cards.service';
import { ExtractedValues, REVIEW_KIND_LABELS, ReviewItem } from '../../../models/review-item.model';
import { CARD_FIELD_LABELS, CARD_UPDATABLE_FIELDS, Card, CardUpdateField, cardLabel } from '../../../models/card.model';
import { TXN_CATEGORIES } from '../../../models/card-transaction.model';
import { fromDateInput, toDateInput } from '../../../utils/date-input.util';

/** String-typed copy of the extracted values for <input> binding. */
interface Draft {
  txnDate: string;
  amount: string;
  direction: 'debit' | 'credit';
  description: string;
  category: string;
  statementDate: string;
  dueDate: string;
  totalDue: string;
  minDue: string;
  expiryMonth: string;
  expiryYear: string;
  statementDay: string;
  dueDay: string;
}

@Component({
  selector: 'app-card-review',
  standalone: true,
  imports: [DatePipe, DecimalPipe, PercentPipe, FormsModule, RouterLink],
  templateUrl: './review.component.html',
  styleUrl: './review.component.scss',
})
export class ReviewComponent {
  private review = inject(ReviewService);
  private cardsService = inject(CardsService);

  readonly kindLabels = REVIEW_KIND_LABELS;
  readonly categories = TXN_CATEGORIES;
  readonly cardFields = CARD_UPDATABLE_FIELDS;
  readonly fieldLabels = CARD_FIELD_LABELS;
  readonly label = cardLabel;

  private rawPending = toSignal(this.review.pending$);
  resolved = toSignal(this.review.resolved$, { initialValue: [] as ReviewItem[] });
  cards = toSignal(this.cardsService.cards$, { initialValue: [] as Card[] });

  loading = computed(() => this.rawPending() === undefined);
  pending = computed(() => this.rawPending() ?? []);
  tab = signal<'pending' | 'history'>('pending');

  /** Card chosen per item (defaults to the parser's match). */
  cardChoice = signal<Record<string, string>>({});
  editingId = signal<string | null>(null);
  draft: Draft = this.emptyDraft();
  busyId = signal<string | null>(null);
  itemError = signal<Record<string, string>>({});
  sampleCardId = signal('');
  loadingSamples = signal(false);
  sampleError = signal('');

  activeCards = computed(() => this.cards().filter(c => c.status === 'Active'));
  private cardMap = computed(() => new Map(this.cards().map(c => [c.id, c])));

  cardFor(item: ReviewItem): Card | undefined {
    return this.cardMap().get(this.chosenCardId(item));
  }

  chosenCardId(item: ReviewItem): string {
    return this.cardChoice()[item.id] ?? item.cardId ?? '';
  }

  chooseCard(item: ReviewItem, cardId: string): void {
    this.cardChoice.update(m => ({ ...m, [item.id]: cardId }));
  }

  cardName(id: string | null): string {
    const c = id ? this.cardMap().get(id) : undefined;
    return c ? cardLabel(c) : 'No card';
  }

  confidenceTone(c: number): string {
    return c >= 0.85 ? 'tone-ok' : c >= 0.6 ? 'tone-soon' : 'tone-overdue';
  }

  /** Current card value for a card_update field (for "current → proposed"). */
  currentValue(item: ReviewItem, f: CardUpdateField): number | undefined {
    return this.cardFor(item)?.[f];
  }

  proposedFields(item: ReviewItem): CardUpdateField[] {
    return this.cardFields.filter(f => item.extracted[f] !== undefined && item.extracted[f] !== null);
  }

  // ── Edit ──────────────────────────────────────────────────────

  startEdit(item: ReviewItem): void {
    const e = item.extracted;
    const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
    this.draft = {
      txnDate: toDateInput(e.txnDate ?? null),
      amount: s(e.amount),
      direction: e.direction ?? 'debit',
      description: e.description ?? '',
      category: e.category ?? 'Others',
      statementDate: toDateInput(e.statementDate ?? null),
      dueDate: toDateInput(e.dueDate ?? null),
      totalDue: s(e.totalDue),
      minDue: s(e.minDue),
      expiryMonth: s(e.expiryMonth),
      expiryYear: s(e.expiryYear),
      statementDay: s(e.statementDay),
      dueDay: s(e.dueDay),
    };
    this.clearError(item.id);
    this.editingId.set(item.id);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.draft = this.emptyDraft();
  }

  // ── Approve / reject ──────────────────────────────────────────

  async approve(item: ReviewItem): Promise<void> {
    const editing = this.editingId() === item.id;
    const values = editing ? this.valuesFromDraft(item) : { ...item.extracted };
    const cardId = this.chosenCardId(item);
    const problem = this.validate(item, values, cardId);
    if (problem) return this.setError(item.id, problem);

    const edited = editing && this.differs(item.extracted, values);
    this.busyId.set(item.id);
    this.clearError(item.id);
    try {
      await this.review.approve(item, values, cardId, edited || cardId !== item.cardId);
      if (editing) this.cancelEdit();
    } catch (err: any) {
      console.error('[Review] approve failed', err);
      this.setError(
        item.id,
        err?.code === 'permission-denied'
          ? 'The server rejected this approval. Check the values (e.g. due date after statement date).'
          : 'Could not approve. Check your connection and try again.'
      );
    } finally {
      this.busyId.set(null);
    }
  }

  async reject(item: ReviewItem): Promise<void> {
    this.busyId.set(item.id);
    try {
      await this.review.reject(item);
      if (this.editingId() === item.id) this.cancelEdit();
    } catch (err) {
      console.error('[Review] reject failed', err);
      this.setError(item.id, 'Could not reject. Try again.');
    } finally {
      this.busyId.set(null);
    }
  }

  async loadSamples(): Promise<void> {
    const card = this.cardMap().get(this.sampleCardId() || this.activeCards()[0]?.id || '');
    if (!card) return;
    this.loadingSamples.set(true);
    this.sampleError.set('');
    try {
      await this.review.loadSamples(card);
    } catch (err) {
      console.error('[Review] samples failed', err);
      this.sampleError.set('Could not create sample items.');
    } finally {
      this.loadingSamples.set(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private valuesFromDraft(item: ReviewItem): ExtractedValues {
    const d = this.draft;
    const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
    if (item.kind === 'transaction') {
      return {
        txnDate: fromDateInput(d.txnDate) ?? undefined,
        amount: num(d.amount),
        direction: d.direction,
        description: d.description.trim(),
        category: d.category,
      };
    }
    if (item.kind === 'statement') {
      return {
        statementDate: fromDateInput(d.statementDate) ?? undefined,
        dueDate: fromDateInput(d.dueDate) ?? undefined,
        totalDue: num(d.totalDue),
        minDue: num(d.minDue),
      };
    }
    const out: ExtractedValues = {};
    for (const f of this.cardFields) {
      const v = num(d[f]);
      if (v !== undefined) out[f] = v;
    }
    return out;
  }

  private validate(item: ReviewItem, v: ExtractedValues, cardId: string): string | null {
    if (!cardId || !this.cardMap().has(cardId)) return 'Choose which card this belongs to.';
    if (item.kind === 'transaction') {
      if (!v.txnDate) return 'Transaction date is missing — tap Edit to add it.';
      if (!(Number(v.amount) > 0)) return 'Amount must be more than 0 — tap Edit to fix it.';
      if (!v.description?.trim()) return 'Description is missing — tap Edit to add it.';
    } else if (item.kind === 'statement') {
      if (!v.statementDate || !v.dueDate) return 'Statement and due dates are required — tap Edit.';
      if (v.dueDate < v.statementDate) return 'Due date cannot be before the statement date.';
      if (!(Number(v.totalDue) >= 0) || !(Number(v.minDue) >= 0)) return 'Total and minimum due are required.';
      if (Number(v.minDue) > Number(v.totalDue)) return 'Minimum due cannot exceed total due.';
    } else {
      const keys = Object.keys(v) as CardUpdateField[];
      if (!keys.length) return 'No change to apply — reject this item instead.';
      for (const k of keys) {
        const n = Number(v[k]);
        const ok =
          Number.isInteger(n) &&
          (k === 'expiryMonth' ? n >= 1 && n <= 12 : k === 'expiryYear' ? n >= 2000 && n <= 2100 : n >= 1 && n <= 31);
        if (!ok) return `${this.fieldLabels[k]} is out of range.`;
      }
    }
    return null;
  }

  private differs(a: ExtractedValues, b: ExtractedValues): boolean {
    const norm = (v: unknown) => (v instanceof Date ? toDateInput(v) : v === undefined || v === null ? '' : String(v));
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ExtractedValues>;
    for (const k of keys) if (norm(a[k]) !== norm(b[k])) return true;
    return false;
  }

  private setError(id: string, msg: string): void {
    this.itemError.update(m => ({ ...m, [id]: msg }));
  }

  private clearError(id: string): void {
    this.itemError.update(m => {
      const { [id]: _, ...rest } = m;
      return rest;
    });
  }

  private emptyDraft(): Draft {
    return {
      txnDate: '', amount: '', direction: 'debit', description: '', category: 'Others',
      statementDate: '', dueDate: '', totalDue: '', minDue: '',
      expiryMonth: '', expiryYear: '', statementDay: '', dueDay: '',
    };
  }
}
