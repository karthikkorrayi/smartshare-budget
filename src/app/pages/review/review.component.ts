import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApprovalInput, ReviewService } from '../../services/review.service';
import { CardsService } from '../../services/cards.service';
import {
  BILL_CATEGORIES,
  CATEGORY_INFO,
  EXPENSE_CATEGORIES,
  ExtractedValues,
  INCOME_CATEGORIES,
  KIND_INFO,
  ReviewItem,
  ReviewKind,
  SWITCHABLE_KINDS,
  categoryFor,
} from '../../models/review-item.model';
import { CARD_FIELD_LABELS, CARD_UPDATABLE_FIELDS, Card, CardUpdateField, cardLabel } from '../../models/card.model';
import { TXN_CATEGORIES } from '../../models/card-transaction.model';
import { fromDateInput, toDateInput } from '../../utils/date-input.util';
import { UndoService } from '../../services/undo.service';

type GroupFilter = 'all' | 'salary' | 'bank' | 'cards' | 'bills' | 'payments';

interface Draft {
  date: string; // txnDate (income/expense/transaction) or dueDate (bill)
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

const BULK_CONFIDENCE = 0.85;

@Component({
  selector: 'app-review-center',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink],
  templateUrl: './review.component.html',
  styleUrl: './review.component.scss',
})
export class ReviewComponent {
  private review = inject(ReviewService);
  private cardsService = inject(CardsService);
  private undo = inject(UndoService);

  readonly categoryInfo = CATEGORY_INFO;
  readonly kindInfo = KIND_INFO;
  readonly switchable = SWITCHABLE_KINDS;
  readonly cardFields = CARD_UPDATABLE_FIELDS;
  readonly fieldLabels = CARD_FIELD_LABELS;
  readonly label = cardLabel;
  readonly groupFilters: { id: GroupFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'salary', label: '💰 Salary' },
    { id: 'bank', label: '🏦 Bank' },
    { id: 'cards', label: '💳 Cards' },
    { id: 'bills', label: '🧾 Bills' },
    { id: 'payments', label: '✅ Payments' },
  ];

  private rawPending = toSignal(this.review.pending$);
  resolved = toSignal(this.review.resolved$, { initialValue: [] as ReviewItem[] });
  cards = toSignal(this.cardsService.cards$, { initialValue: [] as Card[] });

  loading = computed(() => this.rawPending() === undefined);
  /** Items held for Undo disappear (and leave the counts) straight away. */
  pending = computed(() => (this.rawPending() ?? []).filter(i => !this.undo.hidden().has(i.id)));
  tab = signal<'pending' | 'history'>('pending');
  group = signal<GroupFilter>('all');

  shown = computed(() => this.pending().filter(i => (this.group() === 'all' || this.groupOf(i) === this.group()) ));

  // ── History ──────────────────────────────────────────────────
  historyStatus = signal<'all' | 'approved' | 'rejected'>('all');
  historyQuery = signal('');
  openHistoryId = signal<string | null>(null);
  history = computed(() => {
    const q = this.historyQuery().trim().toLowerCase();
    return this.resolved().filter(i =>
      (this.historyStatus() === 'all' || i.status === this.historyStatus()) &&
      (this.group() === 'all' || this.groupOf(i) === this.group()) &&
      (!q || [i.email.subject, i.email.from, i.email.account, i.extracted.description, i.resolvedValues?.description,
              String(i.resolvedValues?.amount ?? i.extracted.amount ?? ''), this.cardName(i.cardId)]
              .some(v => (v ?? '').toString().toLowerCase().includes(q)))
    );
  });
  historyCounts = computed(() => ({
    all: this.resolved().length,
    approved: this.resolved().filter(i => i.status === 'approved').length,
    rejected: this.resolved().filter(i => i.status === 'rejected').length,
  }));
  groupCount = (g: GroupFilter) => (g === 'all' ? this.pending().length : this.pending().filter(i => this.groupOf(i) === g).length);

  /** Reviewer choices (default to the parser's suggestion). */
  kindChoice = signal<Record<string, ReviewKind>>({});
  cardChoice = signal<Record<string, string>>({});
  editingId = signal<string | null>(null);
  draft: Draft = this.emptyDraft();

  busyId = signal<string | null>(null);
  bulkBusy = signal(false);
  itemError = signal<Record<string, string>>({});
  banner = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);
  loadingSamples = signal(false);

  activeCards = computed(() => this.cards().filter(c => c.status === 'Active'));
  private cardMap = computed(() => new Map(this.cards().map(c => [c.id, c])));

  /** Final values next to what the email said — changed fields are flagged. */
  historyRows(i: ReviewItem): { label: string; value: string; was: string | null }[] {
    const fmt = (k: string, v: unknown): string => {
      if (v === undefined || v === null || v === '') return '—';
      if (v instanceof Date) return v.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      if (['amount', 'totalDue', 'minDue'].includes(k)) return '₹' + Number(v).toLocaleString('en-IN');
      return String(v);
    };
    const labels: Record<string, string> = {
      txnDate: 'Date', dueDate: 'Due date', statementDate: 'Statement date', amount: 'Amount', totalDue: 'Total due', minDue: 'Minimum due',
      description: 'Description', category: 'Category', direction: 'Type', expiryMonth: 'Expiry month', expiryYear: 'Expiry year',
      statementDay: 'Statement day', dueDay: 'Due day',
    };
    const final = (i.resolvedValues ?? this.valuesFor(i, i.kind)) as Record<string, unknown>;
    const original = this.valuesFor(i, i.kind) as Record<string, unknown>;
    return Object.keys(labels)
      .filter(k => final[k] !== undefined)
      .map(k => {
        const now = fmt(k, final[k]);
        const before = fmt(k, original[k]);
        return { label: labels[k], value: now, was: i.edited && before !== now ? before : null };
      });
  }

  destinationLink(i: ReviewItem): string {
    return i.kind === 'transaction' ? '/cards/transactions' : i.kind === 'statement' ? '/cards/statements' : i.kind === 'card_update' ? '/cards' : '/';
  }

  toggleHistory(id: string): void {
    this.openHistoryId.update(v => (v === id ? null : id));
  }

  /** Items that can be approved as-is in one tap. */
  bulkReady = computed(() =>
    this.shown().filter(i => i.confidence >= BULK_CONFIDENCE && this.kindOf(i) !== 'card_update' && !this.validate(i, this.kindOf(i), this.valuesFor(i, this.kindOf(i)), this.cardIdOf(i)))
  );

  // ── Accessors ─────────────────────────────────────────────────

  groupOf(i: ReviewItem): GroupFilter {
    return i.category ? CATEGORY_INFO[i.category].group : 'cards';
  }

  kindOf(i: ReviewItem): ReviewKind {
    return this.kindChoice()[i.id] ?? i.kind;
  }

  cardIdOf(i: ReviewItem): string {
    return this.cardChoice()[i.id] ?? i.cardId ?? '';
  }

  needsCard(i: ReviewItem): boolean {
    return KIND_INFO[this.kindOf(i)].needsCard;
  }

  cardName(id: string | null): string {
    const c = id ? this.cardMap().get(id) : undefined;
    return c ? cardLabel(c) : '—';
  }

  /** Only flag what needs attention: low-confidence matches get a "check carefully" chip; others show nothing. */
  needsCheck(i: ReviewItem): boolean {
    return i.confidence < 0.6 || (KIND_INFO[this.kindOf(i)].needsCard && !this.cardIdOf(i));
  }

  categoriesFor(kind: ReviewKind): readonly string[] {
    return kind === 'expense' ? EXPENSE_CATEGORIES : kind === 'income' ? INCOME_CATEGORIES : kind === 'bill' ? BILL_CATEGORIES : TXN_CATEGORIES;
  }

  currentValue(i: ReviewItem, f: CardUpdateField): number | undefined {
    return this.cardMap().get(this.cardIdOf(i))?.[f];
  }

  proposedFields(i: ReviewItem): CardUpdateField[] {
    return this.cardFields.filter(f => i.extracted[f] !== undefined && i.extracted[f] !== null);
  }

  /** Values shaped for a destination (e.g. a statement re-routed to Expense uses its total as the amount). */
  valuesFor(i: ReviewItem, kind: ReviewKind): ExtractedValues {
    const e = i.extracted;
    const when = e.txnDate ?? e.statementDate ?? e.dueDate ?? i.email.receivedAt ?? new Date();
    const amount = e.amount ?? e.totalDue;
    const description = e.description || i.email.subject.slice(0, 80);
    switch (kind) {
      case 'income':
      case 'expense':
        return { txnDate: when, amount, description, category: categoryFor(kind, e.category, TXN_CATEGORIES) };
      case 'transaction':
        return { txnDate: when, amount, direction: e.direction ?? (kind === 'transaction' && i.category === 'payment_confirmation' ? 'credit' : 'debit'), description, category: categoryFor(kind, e.category, TXN_CATEGORIES) };
      case 'bill':
        return { dueDate: e.dueDate ?? when, amount, description, category: categoryFor(kind, e.category, TXN_CATEGORIES) };
      case 'statement':
        return { statementDate: e.statementDate ?? when, dueDate: e.dueDate, totalDue: e.totalDue ?? e.amount, minDue: e.minDue ?? 0 };
      case 'card_update': {
        const out: ExtractedValues = {};
        for (const f of this.cardFields) if (e[f] !== undefined) out[f] = e[f];
        return out;
      }
    }
  }

  view(i: ReviewItem): ExtractedValues {
    return this.valuesFor(i, this.kindOf(i));
  }

  // ── Choices ───────────────────────────────────────────────────

  chooseKind(i: ReviewItem, kind: ReviewKind): void {
    this.kindChoice.update(m => ({ ...m, [i.id]: kind }));
    if (this.editingId() === i.id) this.startEdit(i);
    this.clearError(i.id);
  }

  chooseCard(i: ReviewItem, cardId: string): void {
    this.cardChoice.update(m => ({ ...m, [i.id]: cardId }));
    this.clearError(i.id);
  }

  startEdit(i: ReviewItem): void {
    const v = this.valuesFor(i, this.kindOf(i));
    const s = (x: unknown) => (x === undefined || x === null ? '' : String(x));
    this.draft = {
      date: toDateInput(this.kindOf(i) === 'bill' ? v.dueDate ?? null : v.txnDate ?? null),
      amount: s(v.amount),
      direction: v.direction ?? 'debit',
      description: v.description ?? '',
      category: v.category ?? '',
      statementDate: toDateInput(v.statementDate ?? null),
      dueDate: toDateInput(v.dueDate ?? null),
      totalDue: s(v.totalDue),
      minDue: s(v.minDue),
      expiryMonth: s(v.expiryMonth),
      expiryYear: s(v.expiryYear),
      statementDay: s(v.statementDay),
      dueDay: s(v.dueDay),
    };
    this.clearError(i.id);
    this.editingId.set(i.id);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.draft = this.emptyDraft();
  }

  // ── Approve / reject ──────────────────────────────────────────

  private inputFor(i: ReviewItem): ApprovalInput | string {
    const kind = this.kindOf(i);
    const editing = this.editingId() === i.id;
    const values = editing ? this.valuesFromDraft(kind) : this.valuesFor(i, kind);
    const cardId = KIND_INFO[kind].needsCard ? this.cardIdOf(i) : null;
    const problem = this.validate(i, kind, values, cardId ?? '');
    if (problem) return problem;
    const edited =
      kind !== i.kind ||
      (KIND_INFO[kind].needsCard && cardId !== i.cardId) ||
      (editing && this.differs(this.valuesFor(i, kind), values));
    return { kind, values, cardId, edited };
  }

  /** Validates now; the approval itself is held for 5 s (Undo cancels it). */
  approve(i: ReviewItem): void {
    const input = this.inputFor(i);
    if (typeof input === 'string') return this.setError(i.id, input);
    this.clearError(i.id);
    if (this.editingId() === i.id) this.cancelEdit();
    this.undo.defer(`Approved → ${KIND_INFO[input.kind].module}`, [i.id], () => this.review.approve(i, input));
  }

  approveAllReady(): void {
    const batch = this.bulkReady()
      .map(item => ({ item, input: this.inputFor(item) }))
      .filter((x): x is { item: ReviewItem; input: ApprovalInput } => typeof x.input !== 'string');
    if (!batch.length) return;
    this.undo.defer(`Approved ${batch.length} items`, batch.map(b => b.item.id), async () => {
      const r = await this.review.approveMany(batch);
      if (r.failed) this.banner.set({ kind: 'error', text: `${r.failed} item${r.failed === 1 ? '' : 's'} couldn't be approved — review ${r.failed === 1 ? 'it' : 'them'} individually.` });
    });
  }

  reject(i: ReviewItem): void {
    if (this.editingId() === i.id) this.cancelEdit();
    this.undo.defer('Rejected — nothing was saved', [i.id], () => this.review.reject(i));
  }

  async loadSamples(): Promise<void> {
    this.loadingSamples.set(true);
    try {
      const n = await this.review.loadSamples(this.activeCards()[0] ?? null);
      this.banner.set({ kind: 'ok', text: `${n} sample items added.` });
    } catch (err) {
      console.error('[Review] samples failed', err);
      this.banner.set({ kind: 'error', text: 'Could not create sample items.' });
    } finally {
      this.loadingSamples.set(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private valuesFromDraft(kind: ReviewKind): ExtractedValues {
    const d = this.draft;
    const num = (v: string) => (String(v).trim() === '' ? undefined : Number(v));
    switch (kind) {
      case 'income':
      case 'expense':
        return { txnDate: fromDateInput(d.date) ?? undefined, amount: num(d.amount), description: d.description.trim(), category: d.category };
      case 'transaction':
        return { txnDate: fromDateInput(d.date) ?? undefined, amount: num(d.amount), direction: d.direction, description: d.description.trim(), category: d.category };
      case 'bill':
        return { dueDate: fromDateInput(d.date) ?? undefined, amount: num(d.amount), description: d.description.trim(), category: d.category };
      case 'statement':
        return { statementDate: fromDateInput(d.statementDate) ?? undefined, dueDate: fromDateInput(d.dueDate) ?? undefined, totalDue: num(d.totalDue), minDue: num(d.minDue) };
      case 'card_update': {
        const out: ExtractedValues = {};
        for (const f of this.cardFields) {
          const v = num(d[f]);
          if (v !== undefined) out[f] = v;
        }
        return out;
      }
    }
  }

  private validate(i: ReviewItem, kind: ReviewKind, v: ExtractedValues, cardId: string): string | null {
    if (KIND_INFO[kind].needsCard && (!cardId || !this.cardMap().has(cardId))) return 'Choose which card this belongs to.';
    switch (kind) {
      case 'income':
      case 'expense':
      case 'transaction':
        if (!v.txnDate) return 'Date is missing — tap Edit to add it.';
        if (!(Number(v.amount) > 0)) return 'Amount must be more than 0 — tap Edit to fix it.';
        if (!v.description?.trim()) return 'Description is missing — tap Edit.';
        return null;
      case 'bill':
        if (!v.dueDate) return 'Due date is missing — tap Edit to add it.';
        if (!(Number(v.amount) > 0)) return 'Amount must be more than 0 — tap Edit.';
        return null;
      case 'statement':
        if (!v.statementDate || !v.dueDate) return 'Statement and due dates are required — tap Edit.';
        if (v.dueDate < v.statementDate) return 'Due date cannot be before the statement date.';
        if (!(Number(v.totalDue) >= 0) || v.totalDue === undefined) return 'Total due is required.';
        if (Number(v.minDue) > Number(v.totalDue)) return 'Minimum due cannot exceed total due.';
        return null;
      case 'card_update': {
        const keys = Object.keys(v) as CardUpdateField[];
        if (!keys.length) return 'No change to apply — reject this item instead.';
        for (const k of keys) {
          const n = Number(v[k]);
          const ok = Number.isInteger(n) && (k === 'expiryMonth' ? n >= 1 && n <= 12 : k === 'expiryYear' ? n >= 2000 && n <= 2100 : n >= 1 && n <= 31);
          if (!ok) return `${this.fieldLabels[k]} is out of range.`;
        }
        return null;
      }
    }
    void i;
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
      date: '', amount: '', direction: 'debit', description: '', category: '',
      statementDate: '', dueDate: '', totalDue: '', minDue: '',
      expiryMonth: '', expiryYear: '', statementDay: '', dueDay: '',
    };
  }
}
