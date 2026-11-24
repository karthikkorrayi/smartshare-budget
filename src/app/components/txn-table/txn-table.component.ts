import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { QuickActionsService } from '../../core/quick-actions.service';
import { AccountSummary, refKey } from '../../models/account.model';
import { FinanceTxn, TxnKind, categoryIcon } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { MoneyPipe } from '../../ui/money.pipe';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';
import { OptsPipe } from '../../ui/opts.pipe';

type SortKey = 'date' | 'amount' | 'title';
const PAGE = 30;

/**
 * Searchable, sortable transaction list. A table on desktop, compact cards on phones.
 * Rows open the transaction drawer (details + edit / delete).
 */
@Component({
  selector: 'app-txn-table',
  standalone: true,
  imports: [DatePipe, FormsModule, IconComponent, MoneyPipe, EmptyStateComponent, SkeletonComponent, SelectComponent, OptsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar">
      <label class="input-icon search">
        <app-icon name="search" [size]="16" />
        <input class="input" type="search" placeholder="Search description, category, account…" [ngModel]="q()" (ngModelChange)="q.set($event)" aria-label="Search transactions" />
      </label>
      @if (showFlow()) {
        <div class="seg" role="radiogroup" aria-label="Type">
          @for (f of flows; track f.id) { <button role="radio" [attr.aria-checked]="flow() === f.id" [class.on]="flow() === f.id" (click)="flow.set(f.id)">{{ f.label }}</button> }
        </div>
      }
      <app-select class="sel" [compact]="true" ariaLabel="Category" icon="tag" [ngModel]="cat()" (ngModelChange)="cat.set($event)"
                  [options]="categoryOptions() | opts : undefined : undefined : [{ value: '', label: 'All categories' }]" />
      @if (showAccount()) {
        <app-select class="sel" [compact]="true" ariaLabel="Account" [ngModel]="acct()" (ngModelChange)="acct.set($event)"
                    [options]="accountList() | opts: 'key' : 'name' : [{ value: '', label: 'All accounts', icon: 'layers' }, { value: 'none', label: 'Not linked', icon: 'link' }] : 'icon'" />
      }
      <app-select class="sel" [compact]="true" ariaLabel="Sort" icon="arrow-up-down" [ngModel]="sortSel()" (ngModelChange)="setSort($event)" [options]="sortOptions" />
    </div>

    @if (txns() === null) {
      <app-skeleton variant="row" [count]="6" />
    } @else if (!filtered().length) {
      <app-empty [art]="txns()!.length ? 'range' : 'transactions'" [compact]="true"
        [title]="txns()!.length ? 'No matches' : emptyTitle()"
        [text]="txns()!.length ? 'Try a different search or filter.' : emptyText()" />
    } @else {
      <div class="summary muted tiny">{{ filtered().length }} entr{{ filtered().length === 1 ? 'y' : 'ies' }}
        · in <b class="amt-in">{{ sumIn() | money }}</b> · out <b>{{ sumOut() | money }}</b></div>

      <div class="table-wrap desk">
        <table class="table">
          <thead><tr>
            <th><button (click)="toggleSort('date')">Date @if (sort() === 'date') { <app-icon [name]="dir() === 'asc' ? 'arrow-up' : 'arrow-down'" [size]="12" /> }</button></th>
            <th><button (click)="toggleSort('title')">Description @if (sort() === 'title') { <app-icon [name]="dir() === 'asc' ? 'arrow-up' : 'arrow-down'" [size]="12" /> }</button></th>
            <th>Category</th>
            @if (showAccount()) { <th>Account</th> }
            <th>Status</th>
            <th class="r"><button (click)="toggleSort('amount')">Amount @if (sort() === 'amount') { <app-icon [name]="dir() === 'asc' ? 'arrow-up' : 'arrow-down'" [size]="12" /> }</button></th>
          </tr></thead>
          <tbody>
            @for (t of page(); track t.key) {
              <tr (click)="open(t)" (keydown.enter)="open(t)" tabindex="0" [attr.aria-label]="t.title + ', ' + (t.amount | money)">
                <td class="nowrap muted">{{ t.date | date: 'd MMM y' }}</td>
                <td><div class="desc"><span class="icon-tile sm" [class.pos]="t.flow === 'in'" [class.info]="t.flow === 'move'"><app-icon [name]="t.kind === 'transfer' ? 'arrow-left-right' : icon(t.category)" [size]="15" /></span><span class="truncate">{{ t.title }}</span></div></td>
                <td class="muted">{{ t.category }}</td>
                @if (showAccount()) { <td class="muted truncate acct">{{ accountName(t) }}</td> }
                <td><span class="badge" [class.info]="t.flow === 'move'" [class.accent]="t.system" [class.warn]="t.source === 'email'">{{ status(t) }}</span></td>
                <td class="r num amt" [class.amt-in]="t.flow === 'in'" [class.amt-move]="t.flow === 'move'">{{ t.flow === 'in' ? '+' : t.flow === 'out' ? '−' : '' }}{{ t.amount | money: true }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="cards mob list">
        @for (t of page(); track t.key) {
          <button class="list-row" (click)="open(t)">
            <span class="icon-tile" [class.pos]="t.flow === 'in'" [class.info]="t.flow === 'move'"><app-icon [name]="t.kind === 'transfer' ? 'arrow-left-right' : icon(t.category)" [size]="17" /></span>
            <span class="grow">
              <span class="title">{{ t.title }}</span>
              <span class="sub">{{ t.date | date: 'd MMM' }} · {{ t.category }}@if (showAccount()) { · {{ accountName(t) }} }</span>
            </span>
            <span class="num amt" [class.amt-in]="t.flow === 'in'" [class.amt-move]="t.flow === 'move'">{{ t.flow === 'in' ? '+' : t.flow === 'out' ? '−' : '' }}{{ t.amount | money }}</span>
          </button>
        }
      </div>

      @if (filtered().length > shown()) {
        <div class="more"><button class="btn btn-sm" (click)="shown.set(shown() + pageSize)">Show more ({{ filtered().length - shown() }} left)</button></div>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
    .search { flex: 1 1 240px; min-width: 0; }
    .search input { min-height: 38px; }
    app-select.sel { width: 180px; max-width: 200px; }
    .summary { margin: 0 0 8px; b { color: var(--text-2); } .amt-in { color: var(--pos); } }
    .desc { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 360px; }
    .acct { max-width: 180px; }
    .amt { font-weight: 650; white-space: nowrap; }
    .mob { display: none; }
    .more { display: flex; justify-content: center; padding: 12px 0 2px; }
    @media (max-width: 760px) {
      .desk { display: none; } .mob { display: flex; }
      app-select.sel { flex: 1 1 140px; width: auto; max-width: none; }
    }
  `],
})
export class TxnTableComponent {
  readonly sortOptions: SelectOption[] = [
    { value: 'date:desc', label: 'Newest first' },
    { value: 'date:asc', label: 'Oldest first' },
    { value: 'amount:desc', label: 'Largest amount' },
    { value: 'amount:asc', label: 'Smallest amount' },
    { value: 'title:asc', label: 'Name A–Z' },
  ];

  private quick = inject(QuickActionsService);
  readonly txns = input<FinanceTxn[] | null>(null);
  readonly accounts = input<Map<string, AccountSummary>>(new Map());
  readonly showAccount = input(true);
  readonly showFlow = input(true);
  readonly kinds = input<TxnKind[] | null>(null);
  readonly emptyTitle = input('No transactions yet');
  readonly emptyText = input('Entries you add will appear here.');

  readonly pageSize = PAGE;
  readonly icon = categoryIcon;
  readonly flows = [
    { id: 'all', label: 'All' },
    { id: 'in', label: 'In' },
    { id: 'out', label: 'Out' },
    { id: 'move', label: 'Moves' },
  ] as const;

  q = signal('');
  flow = signal<'all' | 'in' | 'out' | 'move'>('all');
  cat = signal('');
  acct = signal('');
  sort = signal<SortKey>('date');
  dir = signal<'asc' | 'desc'>('desc');
  shown = signal(PAGE);
  sortSel = computed(() => `${this.sort()}:${this.dir()}`);

  accountList = computed(() => [...this.accounts().values()]);
  categoryOptions = computed(() => [...new Set((this.txns() ?? []).map(t => t.category))].sort());

  filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    const kinds = this.kinds();
    const list = (this.txns() ?? []).filter(t => {
      if (kinds && !kinds.includes(t.kind)) return false;
      if (this.flow() !== 'all' && t.flow !== this.flow()) return false;
      if (this.cat() && t.category !== this.cat()) return false;
      if (this.acct() === 'none' && t.account) return false;
      if (this.acct() && this.acct() !== 'none' && refKey(t.account) !== this.acct() && refKey(t.account2) !== this.acct()) return false;
      if (q && ![t.title, t.category, t.note, this.accountName(t), String(t.amount)].some(v => (v ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    const s = this.sort();
    const m = this.dir() === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (s === 'amount') return (a.amount - b.amount) * m;
      if (s === 'title') return a.title.localeCompare(b.title) * m;
      return (a.date.getTime() - b.date.getTime()) * m;
    });
  });
  page = computed(() => this.filtered().slice(0, this.shown()));
  sumIn = computed(() => this.filtered().filter(t => t.flow === 'in').reduce((s, t) => s + t.amount, 0));
  sumOut = computed(() => this.filtered().filter(t => t.flow === 'out').reduce((s, t) => s + t.amount, 0));

  constructor() {
    // New filter → back to the first page.
    effect(() => {
      this.q(); this.flow(); this.cat(); this.acct(); this.sort(); this.dir();
      this.shown.set(PAGE);
    });
  }

  setSort(v: string): void {
    const [s, d] = v.split(':') as [SortKey, 'asc' | 'desc'];
    this.sort.set(s);
    this.dir.set(d);
  }

  toggleSort(s: SortKey): void {
    if (this.sort() === s) this.dir.set(this.dir() === 'asc' ? 'desc' : 'asc');
    else {
      this.sort.set(s);
      this.dir.set(s === 'title' ? 'asc' : 'desc');
    }
  }

  accountName(t: FinanceTxn): string {
    const n = (r: FinanceTxn['account']) => (r ? this.accounts().get(refKey(r))?.name ?? 'Deleted account' : 'Not linked');
    return t.kind === 'transfer' ? `${n(t.account)} → ${n(t.account2)}` : n(t.account);
  }

  status(t: FinanceTxn): string {
    if (t.carryForward) return 'Carry forward';
    if (t.system) return 'Automatic';
    if (t.kind === 'transfer') return 'Transfer';
    if (t.flow === 'move') return 'Not spending';
    if (t.source === 'email') return t.raw?.editedAfterReview ? 'Email · edited' : 'From email';
    return 'Recorded';
  }

  open(t: FinanceTxn): void {
    this.quick.showTxn(t);
  }
}
