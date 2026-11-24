import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../ui/icon.component';
import { DateFieldComponent } from '../../ui/date-field.component';
import { MoneyPipe } from '../../ui/money.pipe';
import { SplitMethod, normalizePhone, splitShares } from '../../models/lending.model';
import { checkDay, dueMoment, toDateInput } from '../../utils/date-input.util';

interface Row {
  name: string;
  phone: string;
  amount: number | null;
}

/**
 * "Split this amount": who shares a payment you made, and how much each owes you.
 * You ("Me") are in the split by default; equal or exact shares; optional phone (for WhatsApp
 * reminders) and a repay-by date. The parent reads `value()` / `problems()` when saving.
 */
@Component({
  selector: 'app-split-editor',
  standalone: true,
  imports: [FormsModule, IconComponent, DateFieldComponent, MoneyPipe],
  styleUrls: ['../../dialogs/lending-form/lend-ui.scss'],
  template: `
    <div class="split">
      <div class="top">
        <span class="lbl" id="sp-m">Split</span>
        <div class="seg" role="radiogroup" aria-labelledby="sp-m">
          <button type="button" role="radio" [attr.aria-checked]="method() === 'equal'" [class.on]="method() === 'equal'" (click)="method.set('equal')"><app-icon name="equal" [size]="13" />Equally</button>
          <button type="button" role="radio" [attr.aria-checked]="method() === 'exact'" [class.on]="method() === 'exact'" (click)="setExact()"><app-icon name="list-ordered" [size]="13" />Exact amounts</button>
        </div>
      </div>

      <!-- You -->
      <label class="row me" [class.off]="!includeMe()">
        <span class="av me-av">Me</span>
        <span class="who"><b>You</b><small>{{ includeMe() ? (category() ? 'Your share counts as ' + category() : 'Your share') : 'Not in this split — others owe the full amount' }}</small></span>
        <b class="num share">{{ includeMe() ? (result().me | money: true) : '—' }}</b>
        <span class="sw"><input type="checkbox" role="switch" [ngModel]="includeMe()" (ngModelChange)="includeMe.set($event)" aria-label="Include me in the split" /></span>
      </label>

      @for (p of people(); track $index; let i = $index) {
        <div class="row person">
          <span class="av">{{ initials(p.name) }}</span>
          <div class="inputs">
            <input class="input" type="text" maxlength="60" placeholder="Name" [attr.aria-label]="'Person ' + (i + 1) + ' name'"
                   [ngModel]="p.name" (ngModelChange)="patch(i, { name: $event })" (blur)="fillPhone(i)" />
            <input class="input phone" type="tel" inputmode="tel" maxlength="18" placeholder="Phone (optional)" [attr.aria-label]="'Person ' + (i + 1) + ' phone'"
                   [ngModel]="p.phone" (ngModelChange)="patch(i, { phone: $event })" [class.bad]="touched() && !!p.phone && !validPhone(p.phone)" />
          </div>
          @if (method() === 'exact') {
            <span class="money-in amt"><i>₹</i><input class="input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" [attr.aria-label]="'Share for ' + (p.name || 'person ' + (i + 1))"
                   [ngModel]="p.amount" (ngModelChange)="patch(i, { amount: $event })" /></span>
          } @else {
            <b class="num share">{{ result().shares[i] | money: true }}</b>
          }
          <button type="button" class="btn btn-ghost btn-icon btn-sm" (click)="remove(i)" [disabled]="people().length === 1" [attr.aria-label]="'Remove ' + (p.name || 'person ' + (i + 1))"><app-icon name="x" [size]="15" /></button>
        </div>
      }

      <div class="adds">
        <button type="button" class="btn btn-sm btn-soft" (click)="add()"><app-icon name="user-plus" [size]="15" />Add person</button>
        @for (c of suggestions(); track c.name) {
          <button type="button" class="chip" (click)="add(c.name, c.phone)"><app-icon name="plus" [size]="12" />{{ c.name }}</button>
        }
      </div>

      <div class="field due">
        <span>Repay by <small class="muted">optional</small></span>
        <app-date ariaLabel="Repay by" [min]="today" [clearable]="true" [quick]="['in7', 'monthEnd']" [invalid]="touched() && !!dueError()"
                  [ngModel]="dueInput()" (ngModelChange)="dueInput.set($event || '')" />
        @if (touched() && dueError(); as e) { <small class="field-err">{{ e }}</small> }
      </div>

      @if (summary(); as s) {
        <div class="calc" aria-live="polite">
          <span class="k"><app-icon name="sparkles" [size]="13" />What gets recorded</span>
          <div class="o"><app-icon name="wallet" [size]="15" /><span>You paid <b>{{ s.total | money: true }}</b>{{ accountName() ? ' from ' + accountName() : '' }} — the account drops by the full amount.</span></div>
          @if (s.me > 0) { <div class="o"><app-icon name="user" [size]="15" /><span>Your share <b>{{ s.me | money: true }}</b> is spending{{ category() ? ' in ' + category() : '' }}.</span></div> }
          <div class="o"><app-icon name="hand-coins" [size]="15" /><span><b>{{ s.owed | money: true }}</b> is owed to you by {{ s.count }} {{ s.count === 1 ? 'person' : 'people' }} — booked as “Lent”, with {{ s.count === 1 ? 'a lending record' : 'a lending record each' }}. Repayments come back as income.</span></div>
        </div>
      }
      @if (touched() && problems().length) {
        <ul class="errs" role="alert">@for (e of problems(); track e) { <li>{{ e }}</li> }</ul>
      }
    </div>
  `,
  styles: [`
    .split { display: flex; flex-direction: column; gap: 10px; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .lbl { font-size: 13px; font-weight: 650; }
    .row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 8px 10px;
      border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
    .row.me { cursor: pointer; background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      &.off { background: var(--surface-2); border-color: var(--border); .share { color: var(--text-4); } } }
    .av { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--surface-3, var(--surface-2)); color: var(--text-2);
      font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .me-av { background: var(--accent); color: #fff; text-transform: none; }
    .who { display: flex; flex-direction: column; min-width: 0; b { font-size: 13.5px; } small { font-size: 12px; color: var(--text-3); } }
    .share { font-size: 14px; min-width: 70px; text-align: right; font-variant-numeric: tabular-nums; }
    .sw input { width: 38px; height: 22px; accent-color: var(--accent); cursor: pointer; }
    .inputs { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 6px; min-width: 0;
      .input { min-height: 36px; } .bad { border-color: var(--neg); } }
    .amt { width: 112px; flex: none; .input { min-height: 36px; } }
    .adds { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .due { max-width: 280px; }
    .errs { margin: 0; padding: 10px 14px 10px 30px; border-radius: 12px; background: var(--neg-soft); color: var(--neg); font-size: 13px; line-height: 1.5; }
    @media (max-width: 520px) {
      .row.person { grid-template-columns: 34px minmax(0, 1fr) auto; grid-template-areas: 'av in x' 'av amt amt'; }
      .row.person .av { grid-area: av; align-self: start; } .row.person .inputs { grid-area: in; grid-template-columns: 1fr; }
      .row.person .share, .row.person .amt { grid-area: amt; justify-self: end; } .row.person > button { grid-area: x; align-self: start; }
    }
  `],
})
export class SplitEditorComponent {
  /** The amount being split. */
  readonly total = input<number>(0);
  /** People used before (name + phone) for one-tap adding. */
  readonly contacts = input<{ name: string; phone: string }[]>([]);
  readonly category = input<string>('');
  readonly accountName = input<string>('');
  /** Set by the parent when the user tries to save, to show problems. */
  readonly touched = input(false);

  readonly today = toDateInput(new Date());
  includeMe = signal(true);
  method = signal<SplitMethod>('equal');
  people = signal<Row[]>([{ name: '', phone: '', amount: null }]);
  dueInput = signal('');

  readonly result = computed(() => splitShares(Number(this.total()) || 0, this.people().map(p => ({ name: p.name, amount: p.amount })), this.includeMe(), this.method()));
  readonly dueError = computed(() => (this.dueInput() ? checkDay(this.dueInput(), { label: 'the repay-by date', notPast: true }) ?? '' : ''));

  readonly suggestions = computed(() => {
    const used = new Set(this.people().map(p => p.name.trim().toLowerCase()).filter(Boolean));
    return this.contacts().filter(c => !used.has(c.name.toLowerCase())).slice(0, 6);
  });

  readonly summary = computed(() => {
    const r = this.result();
    const total = Number(this.total()) || 0;
    if (!(total > 0) || r.error) return null;
    const owed = Math.round((total - r.me) * 100) / 100;
    return { total, me: r.me, owed, count: this.people().length };
  });

  readonly problems = computed(() => {
    const out: string[] = [];
    const ppl = this.people();
    if (ppl.some(p => !p.name.trim())) out.push('Give every person a name (or remove the empty row).');
    const names = ppl.map(p => p.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(names).size !== names.length) out.push('The same name is in the split twice.');
    if (names.includes('me') || names.includes('you')) out.push('You’re already in the split as “Me”.');
    if (ppl.some(p => p.phone.trim() && !normalizePhone(p.phone))) out.push('A phone number looks incomplete — use 10 digits, or include the country code.');
    const r = this.result();
    if (r.error) out.push(r.error);
    if (this.dueError()) out.push(this.dueError());
    return out;
  });

  /** What the ledger needs. */
  value() {
    const r = this.result();
    return {
      me: r.me,
      people: this.people().map((p, i) => ({ name: p.name.trim(), phone: normalizePhone(p.phone), share: r.shares[i] })),
      dueDate: this.dueInput() ? dueMoment(this.dueInput()) : null,
    };
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase() : '?';
  }
  validPhone(p: string): boolean {
    return !!normalizePhone(p);
  }

  patch(i: number, change: Partial<Row>): void {
    this.people.update(list => list.map((p, j) => (j === i ? { ...p, ...change } : p)));
  }
  add(name = '', phone = ''): void {
    const list = this.people();
    const empty = list.findIndex(p => !p.name.trim() && !p.phone.trim());
    if (name && empty >= 0) return this.patch(empty, { name, phone });
    this.people.set([...list, { name, phone, amount: null }]);
  }
  remove(i: number): void {
    this.people.update(list => (list.length > 1 ? list.filter((_, j) => j !== i) : list));
  }
  /** Typing a known name fills in their number. */
  fillPhone(i: number): void {
    const p = this.people()[i];
    if (!p || p.phone.trim()) return;
    const c = this.contacts().find(x => x.name.toLowerCase() === p.name.trim().toLowerCase());
    if (c?.phone) this.patch(i, { phone: c.phone.startsWith('91') && c.phone.length === 12 ? c.phone.slice(2) : '+' + c.phone });
  }
  /** Switching to exact pre-fills each person with their equal share, so only the differences need typing. */
  setExact(): void {
    if (this.method() === 'exact') return;
    const r = this.result();
    if (!r.error) this.people.update(list => list.map((p, i) => ({ ...p, amount: p.amount ?? r.shares[i] })));
    this.method.set('exact');
  }
}
