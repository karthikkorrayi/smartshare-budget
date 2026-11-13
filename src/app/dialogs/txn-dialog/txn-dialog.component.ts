import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FinanceService } from '../../services/finance.service';
import { LedgerService } from '../../services/ledger.service';
import { UndoService } from '../../services/undo.service';
import { QuickActionsService, TxnMode } from '../../core/quick-actions.service';
import { AccountRef, AccountSummary, parseRef, refKey } from '../../models/account.model';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../models/review-item.model';
import { FinanceTxn, categoryIcon, inr } from '../../utils/analytics.util';
import { fromDateInput, toDateInput } from '../../utils/date-input.util';
import { IconComponent } from '../../ui/icon.component';
import { MoneyPipe } from '../../ui/money.pipe';
import { EmptyStateComponent } from '../../ui/empty-state.component';

export interface TxnDialogData {
  mode?: TxnMode;
  account?: AccountRef | null;
  txn?: FinanceTxn;
}

// Spending categories offered for new entries (existing Overview list + a few common ones).
const SPEND_CATEGORIES = ['Food', 'Groceries', 'Shopping', 'Transport', 'Bills', 'Petrol', 'Health', 'Entertainment', 'Education', 'Travel', 'Rent', 'EMI', 'Tickets', 'Lent', 'Card Bill', 'Wallet Top-up', 'Others'];
const INCOME_CATS = [...INCOME_CATEGORIES, 'Business', 'Gift', 'Repayment'];

/**
 * Add / edit an Expense, Income or Transfer. Every entry is tied to an account the user picks first:
 *   Expense  → bank account, credit card or wallet
 *   Income   → bank account or wallet
 *   Transfer → bank / wallet → bank / wallet
 */
@Component({
  standalone: true,
  imports: [FormsModule, IconComponent, MoneyPipe, EmptyStateComponent],
  templateUrl: './txn-dialog.component.html',
  styleUrl: './txn-dialog.component.scss',
})
export class TxnDialogComponent {
  private ref = inject(MatDialogRef<TxnDialogComponent>);
  private finance = inject(FinanceService);
  private ledger = inject(LedgerService);
  private undo = inject(UndoService);
  private quick = inject(QuickActionsService);
  data: TxnDialogData = inject(MAT_DIALOG_DATA) ?? {};

  readonly editing = this.data.txn ?? null;
  readonly todayInput = toDateInput(new Date());
  readonly catIcon = categoryIcon;

  mode = signal<TxnMode>(this.initialMode());
  accounts = toSignal(this.finance.accounts$);
  loading = computed(() => this.accounts() === undefined);
  active = computed(() => (this.accounts() ?? []).filter(a => a.status === 'Active' || (this.editing && this.isCurrent(a))));

  /** Accounts that make sense for the current mode. */
  options = computed(() => {
    const m = this.mode();
    return this.active().filter(a => (m === 'expense' ? true : a.type !== 'card'));
  });
  groups = computed(() => {
    const o = this.options();
    return [
      { label: 'Bank accounts', items: o.filter(a => a.type === 'bank') },
      { label: 'Wallets & cash', items: o.filter(a => a.type === 'wallet') },
      { label: 'Credit cards', items: o.filter(a => a.type === 'card') },
    ].filter(g => g.items.length);
  });

  accountKey = signal<string>(this.initialAccount());
  toKey = signal<string>(this.editing?.kind === 'transfer' ? refKey(this.editing.account2) : '');
  amount = signal<number | null>(this.editing ? this.editing.amount : null);
  title = signal<string>(this.editing ? this.editing.title : '');
  category = signal<string>(this.editing?.category ?? (this.mode() === 'income' ? 'Salary' : 'Food'));
  dateInput = signal<string>(toDateInput(this.editing?.date ?? new Date()));
  notes = signal<string>(this.editing?.raw?.notes ?? '');
  allowOverdraw = signal(false);

  saving = signal(false);
  errors = signal<string[]>([]);
  touched = signal(false);

  selected = computed(() => this.options().find(a => a.key === this.accountKey()) ?? null);
  destination = computed(() => this.options().find(a => a.key === this.toKey()) ?? null);
  categories = computed(() => {
    const base = this.mode() === 'income' ? INCOME_CATS : SPEND_CATEGORIES;
    const c = this.category();
    return c && !base.includes(c) ? [...base, c] : base;
  });
  /** Card and wallet entries can't carry notes (their documents have a fixed shape). */
  notesAllowed = computed(() => this.mode() !== 'transfer' && !(this.mode() === 'expense' && this.selected()?.type !== 'bank' && this.selected() !== null));

  /** Balance after this entry (bank / wallet only). */
  projected = computed(() => {
    const a = this.selected();
    const amt = Number(this.amount()) || 0;
    if (!a || a.type === 'card' || !amt) return null;
    const before = this.editing && this.isCurrent(a) ? a.balance + this.signedEffect(this.editing) * -1 : a.balance;
    const delta = this.mode() === 'income' ? amt : -amt;
    return { before: round(before), after: round(before + delta) };
  });
  overdraw = computed(() => {
    const p = this.projected();
    return !!p && this.mode() !== 'income' && p.after < 0 && p.before >= 0 - 0.001;
  });

  readonly titleLabel = computed(() => (this.mode() === 'income' ? 'Source' : this.mode() === 'transfer' ? 'Note' : 'Description'));
  readonly heading = computed(() => {
    const verb = this.editing ? 'Edit' : 'Add';
    return this.mode() === 'income' ? `${verb} income` : this.mode() === 'transfer' ? `${verb} transfer` : `${verb} expense`;
  });

  setMode(m: TxnMode): void {
    if (this.editing) return;
    this.mode.set(m);
    this.errors.set([]);
    this.category.set(m === 'income' ? 'Salary' : 'Food');
    if (!this.options().some(a => a.key === this.accountKey())) this.accountKey.set('');
    if (m !== 'transfer') this.toKey.set('');
  }

  pickAccount(a: AccountSummary): void {
    this.accountKey.set(a.key);
    if (this.toKey() === a.key) this.toKey.set('');
    this.allowOverdraw.set(false);
  }

  addAccount(type: 'bank' | 'wallet' | 'card'): void {
    this.quick.addAccount(type);
  }

  private validate(): string[] {
    const out: string[] = [];
    const m = this.mode();
    if (!this.selected()) out.push(m === 'transfer' ? 'Choose the account the money leaves from.' : m === 'income' ? 'Choose the account the money went into.' : 'Choose the account, card or wallet you paid from.');
    if (m === 'transfer') {
      if (!this.destination()) out.push('Choose where the money goes.');
      else if (this.destination()!.key === this.accountKey()) out.push('Pick two different accounts.');
    }
    const amt = Number(this.amount());
    if (!(amt > 0)) out.push('Enter an amount greater than 0.');
    if (amt >= 1e9) out.push('That amount is too large.');
    if (m !== 'transfer' && !this.title().trim()) out.push(m === 'income' ? 'Add where the money came from.' : 'Add a short description.');
    const day = fromDateInput(this.dateInput());
    if (!day) out.push('Pick a valid date.');
    else if (m !== 'income' && day > new Date()) out.push('The date can’t be in the future.');
    if (this.overdraw() && !this.allowOverdraw()) out.push(`This takes ${this.selected()!.name} below zero. Tick “Record anyway” if the balance shown is out of date.`);
    if (this.editing?.system) out.push('System-generated entries can’t be edited.');
    return out;
  }

  async save(): Promise<void> {
    this.touched.set(true);
    const problems = this.validate();
    this.errors.set(problems);
    if (problems.length) return;

    const acc = parseRef(this.accountKey());
    const day = fromDateInput(this.dateInput())!;
    const now = new Date();
    const date = toDateInput(day) === toDateInput(now) ? now : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
    const amount = Number(this.amount());
    const title = this.title().trim();
    const m = this.mode();

    this.saving.set(true);
    try {
      let msg = '';
      let undo: () => Promise<unknown>;
      if (m === 'transfer') {
        const to = parseRef(this.toKey())!;
        const s = this.editing
          ? await this.ledger.updateTransfer(this.editing, acc!, to, amount, date, title)
          : await this.ledger.recordTransfer(acc!, to, amount, date, title);
        undo = s.undo;
        msg = `${this.editing ? 'Updated' : 'Moved'} ${inr(amount)} · ${this.selected()!.name} → ${this.destination()!.name}`;
      } else if (m === 'income') {
        const f = { source: title, amount, category: this.category(), date, notes: this.notes() };
        const s = this.editing ? await this.ledger.updateIncome(this.editing, acc, f) : await this.ledger.recordIncome(acc, f);
        undo = s.undo;
        msg = `${this.editing ? 'Updated' : 'Added'} income "${title}" · ${inr(amount)}`;
      } else {
        const f = { description: title, amount, category: this.category(), date, notes: this.notesAllowed() ? this.notes() : '' };
        const s = this.editing ? await this.ledger.updateExpense(this.editing, acc, f) : await this.ledger.recordExpense(acc, f);
        undo = s.undo;
        msg = `${this.editing ? 'Updated' : 'Added'} "${title}" · ${inr(amount)} from ${this.selected()!.name}`;
      }
      this.undo.offer(msg, undo);
      this.ref.close(true);
    } catch (err: any) {
      console.error('[TxnDialog] save failed', err);
      const denied = err?.code === 'permission-denied';
      this.errors.set([denied ? 'The server rejected this entry. Check the account still exists and try again.' : err?.message && !err?.code ? err.message : 'Could not save. Check your connection and try again.']);
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.ref.close();
  }

  // ── helpers ──────────────────────────────────────────────────
  private initialMode(): TxnMode {
    const t = this.data.txn;
    if (t) return t.kind === 'income' ? 'income' : t.kind === 'transfer' ? 'transfer' : 'expense';
    return this.data.mode ?? 'expense';
  }

  private initialAccount(): string {
    if (this.data.txn) return refKey(this.data.txn.account);
    if (this.data.account) return refKey(this.data.account);
    return '';
  }

  private isCurrent(a: AccountSummary): boolean {
    const t = this.editing;
    return !!t && (refKey(t.account) === a.key || refKey(t.account2) === a.key);
  }

  /** Effect the entry being edited already has on its own account's balance. */
  private signedEffect(t: FinanceTxn): number {
    if (t.kind === 'income') return t.amount;
    if (t.kind === 'transfer') return -t.amount;
    return -t.amount;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
