import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FinanceService } from '../../services/finance.service';
import { LoanService } from '../../services/loan.service';
import { EmiPlanChoice, LoanLedgerService } from '../../services/loan-ledger.service';
import { UndoService } from '../../services/undo.service';
import { LOAN_KINDS, Loan, LoanKind, amortize, datesBefore, loanFrom, loanStatus, standardEmi } from '../../models/loan.model';
import { parseRef, refKey } from '../../models/account.model';
import { checkDay, entryMoment, toDateInput } from '../../utils/date-input.util';
import { inr } from '../../utils/analytics.util';
import { IconComponent } from '../../ui/icon.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';
import { DateFieldComponent } from '../../ui/date-field.component';

type PlanMode = 'create' | 'link' | 'none' | 'keep';

/**
 * Add or edit a loan. The EMI is worked out from amount, rate and tenure (or entered as the bank
 * charges it); the panel shows the total interest, what's still owed today and when it ends.
 * A new loan can create its monthly EMI payment, or be linked to one you already track.
 */
@Component({
  standalone: true,
  imports: [FormsModule, IconComponent, SelectComponent, DateFieldComponent],
  styleUrls: ['../lending-form/lend-ui.scss'],
  template: `
    <div class="dlg" role="dialog" aria-modal="true" [attr.aria-label]="existing() ? 'Edit loan' : 'Add a loan'">
      <div class="dlg-head">
        <span class="icon-tile lg warn"><app-icon [name]="kindIcon()" [size]="22" /></span>
        <div><h2>{{ existing() ? 'Edit loan' : 'Add a loan' }}</h2><p>Home, vehicle, personal or any EMI you're repaying.</p></div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>

      <div class="dlg-body">
        <div class="kinds" role="radiogroup" aria-label="Loan type">
          @for (k of kinds; track k.id) {
            <button type="button" class="chip" role="radio" [attr.aria-checked]="kind() === k.id" [class.on]="kind() === k.id" (click)="setKind(k.id)"><app-icon [name]="k.icon" [size]="13" />{{ k.label }}</button>
          }
        </div>
        <div class="form-grid">
          <label class="field"><span>Name</span><input type="text" maxlength="60" [ngModel]="name()" (ngModelChange)="name.set($event); nameTouched = true" placeholder="Home loan" [class.invalid]="touched() && !name().trim()" /></label>
          <label class="field"><span>Lender <small class="muted">optional</small></span><input type="text" maxlength="60" [ngModel]="lender()" (ngModelChange)="lender.set($event)" placeholder="SBI, HDFC, Bajaj…" /></label>
          <div class="field"><span>Loan amount</span>
            <span class="money-in"><i>₹</i><input type="number" min="0" step="1000" inputmode="decimal" [ngModel]="principal()" (ngModelChange)="principal.set($event)" placeholder="0" aria-label="Loan amount" [class.invalid]="touched() && !(Number(principal()) > 0)" /></span></div>
          <label class="field"><span>Interest rate <small class="muted">% a year</small></span>
            <input type="number" min="0" max="60" step="0.05" inputmode="decimal" [ngModel]="rate()" (ngModelChange)="rate.set($event)" placeholder="9" [class.invalid]="touched() && !!rateError()" /></label>
          <div class="field"><span>Tenure</span>
            <div class="tenure">
              <input type="number" min="1" step="1" inputmode="numeric" [ngModel]="tenure()" (ngModelChange)="tenure.set($event)" aria-label="Tenure" [class.invalid]="touched() && !!tenureError()" />
              <div class="seg"><button type="button" [class.on]="unit() === 'y'" (click)="setUnit('y')">Years</button><button type="button" [class.on]="unit() === 'm'" (click)="setUnit('m')">Months</button></div>
            </div></div>
          <div class="field"><span>First EMI date</span>
            <app-date ariaLabel="First EMI date" [ngModel]="firstInput()" (ngModelChange)="firstInput.set($event)" [invalid]="touched() && !!dateError()" /></div>

          <div class="field span-2">
            <label class="toggle" [class.on]="customEmi()"><input type="checkbox" [ngModel]="customEmi()" (ngModelChange)="setCustomEmi($event)" />
              <span><b>My EMI is different</b><small>Use the exact EMI on your loan statement (banks round, add fees, or use floating rates).</small></span></label>
          </div>
          @if (customEmi()) {
            <div class="field"><span>EMI</span><span class="money-in"><i>₹</i><input type="number" min="0" step="1" inputmode="decimal" [ngModel]="emiInput()" (ngModelChange)="emiInput.set($event)" aria-label="EMI" [class.invalid]="touched() && !!emiError()" /></span></div>
          }
          <div class="field"><span>EMIs already paid</span>
            <input type="number" min="0" step="1" inputmode="numeric" [ngModel]="paidBefore()" (ngModelChange)="paidBefore.set($event); paidTouched = true" aria-label="EMIs already paid" />
            <small>{{ paidTouched ? 'As you entered.' : 'EMI dates before today — change it if any were missed.' }}</small></div>
          <div class="field"><span>Paid from</span>
            <app-select ariaLabel="Paid from" [ngModel]="accountKey()" (ngModelChange)="accountKey.set($event)" [options]="accountOptions()" /></div>

          <div class="field span-2">
            <span>Monthly EMI payment</span>
            <div class="seg full" role="radiogroup" aria-label="Monthly EMI payment">
              @for (o of planModes(); track o.id) {
                <button type="button" role="radio" [attr.aria-checked]="planMode() === o.id" [class.on]="planMode() === o.id" (click)="planMode.set(o.id)"><app-icon [name]="o.icon" [size]="14" />{{ o.label }}</button>
              }
            </div>
            <small>{{ planHint() }}</small>
          </div>
          @if (planMode() === 'link') {
            <div class="field span-2"><span>EMI payment to link</span>
              <app-select ariaLabel="EMI payment to link" [ngModel]="linkId()" (ngModelChange)="linkId.set($event)" [options]="linkOptions()" placeholder="Choose a payment" /></div>
          }
          @if (planMode() === 'create' || planMode() === 'keep') {
            <label class="toggle span-2" [class.on]="autopay()"><input type="checkbox" [ngModel]="autopay()" (ngModelChange)="autopay.set($event)" />
              <span><b>Auto-debit</b><small>The bank takes the EMI automatically; you still confirm each one with “Mark paid”.</small></span></label>
          }
          <label class="field span-2"><span>Notes <small class="muted">optional</small></span><textarea rows="2" maxlength="300" [ngModel]="notes()" (ngModelChange)="notes.set($event)" placeholder="Loan account number (last digits), insurance…"></textarea></label>
        </div>

        @if (calc(); as c) {
          <div class="calc" aria-live="polite">
            <span class="k"><app-icon name="calculator" [size]="13" />How this loan works</span>
            @if (c.invalid) {
              <div class="o"><app-icon name="circle-alert" [size]="15" /><span>An EMI of <b>{{ m(emi()) }}</b> doesn't cover the first month's interest ({{ m(c.firstInterest) }}) — the loan would never be repaid.</span></div>
            } @else {
              <div class="o"><app-icon name="repeat" [size]="15" /><span><b>{{ m(emi()) }}</b> a month for {{ c.total }} months{{ customEmi() ? '' : ' (standard reducing-balance EMI)' }}, ending <b>{{ c.end }}</b>.</span></div>
              <div class="o"><app-icon name="percent" [size]="15" /><span>Total interest <b>{{ m(c.interest) }}</b> — you repay <b>{{ m(c.payable) }}</b> for {{ m(Number(principal())) }}.</span></div>
              <div class="o"><app-icon name="scale" [size]="15" /><span>Owed today after {{ c.paid }} EMI{{ c.paid === 1 ? '' : 's' }}: <b>{{ m(c.outstanding) }}</b> — this counts in your net worth as a liability.</span></div>
            }
          </div>
        }
        @if (touched() && problems().length) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><ul>@for (p of problems(); track p) { <li>{{ p }}</li> }</ul></div> }
        @if (error()) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><span>{{ error() }}</span></div> }
      </div>
      <div class="dlg-foot">
        <button class="btn" (click)="ref.close()" [disabled]="saving()">Cancel</button>
        <button class="btn btn-primary" (click)="save()" [disabled]="saving()">
          @if (saving()) { <span class="spinner"></span> Saving… } @else { <app-icon name="check" [size]="16" />{{ existing() ? 'Save changes' : 'Add loan' }} }
        </button>
      </div>
    </div>
  `,
  styles: [`
    .kinds { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
    .tenure { display: flex; gap: 8px; align-items: center; input { flex: 1; min-width: 0; } .seg { flex-shrink: 0; } }
  `],
})
export class LoanFormComponent {
  ref = inject(MatDialogRef<LoanFormComponent>);
  private data = inject<{ id?: string | null }>(MAT_DIALOG_DATA) ?? {};
  private finance = inject(FinanceService);
  private loansService = inject(LoanService);
  private loanLedger = inject(LoanLedgerService);
  private undo = inject(UndoService);

  readonly Number = Number;
  readonly kinds = LOAN_KINDS;
  readonly m = (n: number) => inr(n, true);
  private loans = toSignal(this.loansService.loans$);
  private plans = toSignal(this.finance.recurring$, { initialValue: [] });
  private accounts = toSignal(this.finance.accounts$, { initialValue: [] });

  existing = computed<Loan | null>(() => (this.data.id ? this.loans()?.find(l => l.id === this.data.id) ?? null : null));

  kind = signal<LoanKind>('home');
  name = signal('Home loan');
  lender = signal('');
  principal = signal<number | null>(null);
  rate = signal<number | null>(null);
  tenure = signal<number | null>(20);
  unit = signal<'y' | 'm'>('y');
  firstInput = signal(toDateInput(new Date()));
  customEmi = signal(false);
  emiInput = signal<number | null>(null);
  paidBefore = signal<number | null>(0);
  accountKey = signal('');
  planMode = signal<PlanMode>('create');
  linkId = signal('');
  autopay = signal(true);
  notes = signal('');
  touched = signal(false);
  saving = signal(false);
  error = signal('');
  nameTouched = false;
  paidTouched = false;
  private filled = false;

  readonly months = computed(() => Math.round((Number(this.tenure()) || 0) * (this.unit() === 'y' ? 12 : 1)));
  readonly first = computed(() => (this.firstInput() ? entryMoment(this.firstInput()) : new Date()));
  readonly formulaEmi = computed(() => standardEmi(Number(this.principal()) || 0, Number(this.rate()) || 0, this.months()));
  readonly emi = computed(() => (this.customEmi() ? Number(this.emiInput()) || 0 : this.formulaEmi()));
  readonly kindIcon = computed(() => LOAN_KINDS.find(k => k.id === this.kind())?.icon ?? 'landmark');

  /** EMI dates up to today (the default for "already paid"). */
  readonly datesPassed = computed(() => {
    const rows = amortize(Number(this.principal()) || 0, Number(this.rate()) || 0, this.emi(), this.first());
    return datesBefore(rows);
  });

  readonly calc = computed(() => {
    const P = Number(this.principal()) || 0;
    if (!(P > 0) || !(this.months() > 0) || !(this.emi() > 0)) return null;
    const draft = loanFrom({ id: 'draft', principal: P, rate: Number(this.rate()) || 0, tenureMonths: this.months(), firstEmiDate: this.first(), emi: this.emi() });
    const s = loanStatus(draft, { installmentsPaid: Math.max(0, Math.round(Number(this.paidBefore()) || 0)) });
    return {
      invalid: s.invalid,
      firstInterest: Math.round(P * (Number(this.rate()) || 0) / 1200 * 100) / 100,
      total: s.total,
      end: s.endDate?.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) ?? '',
      interest: s.totalInterest,
      payable: s.totalPayable,
      paid: s.paid,
      outstanding: s.outstanding,
    };
  });

  readonly accountOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Not linked', icon: 'link' },
    ...this.accounts()
      .filter(a => a.type !== 'card' && (a.status === 'Active' || a.key === this.accountKey()))
      .map(a => ({ value: a.key, label: a.name, icon: a.icon, group: a.type === 'bank' ? 'Bank accounts' : 'Wallets & cash' })),
  ]);

  /** EMI-style payments you already track that no other loan uses. */
  readonly linkable = computed(() => {
    const used = new Set((this.loans() ?? []).filter(l => l.id !== this.existing()?.id).map(l => l.recurringId).filter(Boolean));
    return this.plans().filter(p => !used.has(p.id) && !p.completed && p.frequency === 'monthly' && (p.endType === 'count' || p.category === 'EMI'));
  });
  readonly linkOptions = computed<SelectOption[]>(() =>
    this.linkable().map(p => ({ value: p.id, label: `${p.description} · ${inr(p.amount)}${p.endType === 'count' ? ` · ${p.installmentsPaid}/${p.installmentsTotal} paid` : ''}`, icon: 'repeat' }))
  );
  readonly planModes = computed<{ id: PlanMode; label: string; icon: string }[]>(() => {
    const e = this.existing();
    if (e?.recurringId) return [{ id: 'keep', label: 'Keep in step', icon: 'repeat' }, { id: 'none', label: 'Unlink', icon: 'unlink' }];
    return [
      { id: 'create', label: 'Create it', icon: 'plus' },
      ...(this.linkable().length ? [{ id: 'link' as PlanMode, label: 'Link existing', icon: 'link-2' }] : []),
      { id: 'none', label: 'Not now', icon: 'x' },
    ];
  });
  readonly planHint = computed(() => {
    switch (this.planMode()) {
      case 'create': return 'Adds a monthly recurring payment: reminders before each EMI, and “Mark paid” books it as an expense and moves this loan on.';
      case 'link': return 'Uses a recurring payment you already have for this EMI; its paid count drives what’s still owed.';
      case 'keep': return 'The linked EMI payment is updated with the new amount and term.';
      default: return this.existing()?.recurringId ? 'The EMI payment stays, but no longer moves this loan; EMI dates up to today count as paid.' : 'No reminders — EMI dates up to today count as paid.';
    }
  });

  readonly rateError = computed(() => (this.rate() === null || this.rate() === ('' as any) ? 'Enter the interest rate (0 for a no-cost EMI).' : Number(this.rate()) < 0 || Number(this.rate()) > 60 ? 'Interest rate must be between 0 and 60 %.' : ''));
  readonly tenureError = computed(() => (!(this.months() >= 1) || this.months() > 600 ? 'Tenure must be 1 month to 50 years.' : ''));
  readonly dateError = computed(() => checkDay(this.firstInput(), { label: 'the first EMI date' }) ?? '');
  readonly emiError = computed(() => (this.customEmi() && !(Number(this.emiInput()) > 0) ? 'Enter your EMI.' : ''));
  readonly problems = computed(() => {
    const out: string[] = [];
    if (!this.name().trim()) out.push('Give the loan a name.');
    if (!(Number(this.principal()) > 0)) out.push('Enter the loan amount.');
    if (Number(this.principal()) >= 1e9) out.push('That amount is too large.');
    for (const e of [this.rateError(), this.tenureError(), this.dateError(), this.emiError()]) if (e) out.push(e);
    if (this.calc()?.invalid) out.push('The EMI must be more than the first month’s interest.');
    if (Number(this.paidBefore()) < 0 || (this.calc() && Number(this.paidBefore()) > (this.calc()!.total || 0))) out.push('EMIs already paid can’t be more than the number of EMIs.');
    if (this.planMode() === 'link' && !this.linkId()) out.push('Choose the EMI payment to link.');
    return out;
  });

  constructor() {
    // Editing: fill once the loan has loaded.
    effect(() => {
      const e = this.existing();
      if (!e || this.filled) return;
      this.filled = true;
      untracked(() => {
        this.kind.set(e.kind);
        this.name.set(e.name);
        this.nameTouched = true;
        this.lender.set(e.lender);
        this.principal.set(e.principal);
        this.rate.set(e.rate);
        const years = e.tenureMonths % 12 === 0;
        this.unit.set(years ? 'y' : 'm');
        this.tenure.set(years ? e.tenureMonths / 12 : e.tenureMonths);
        this.firstInput.set(toDateInput(e.firstEmiDate));
        const std = standardEmi(e.principal, e.rate, e.tenureMonths);
        this.customEmi.set(Math.abs(std - e.emi) > 0.5);
        this.emiInput.set(e.emi);
        this.paidBefore.set(e.paidBefore);
        this.paidTouched = true;
        this.accountKey.set(e.account ? refKey(e.account) : '');
        this.planMode.set(e.recurringId ? 'keep' : 'none');
        this.autopay.set(!!this.plans().find(p => p.id === e.recurringId)?.autopay);
        this.notes.set(e.notes);
      });
    });
    // New loan: "already paid" follows the EMI dates until the user types their own number.
    effect(() => {
      const n = this.datesPassed();
      if (!this.existing() && !this.paidTouched) untracked(() => this.paidBefore.set(n));
    });
  }

  setKind(k: LoanKind): void {
    this.kind.set(k);
    if (!this.nameTouched) this.name.set(k === 'consumer' ? 'EMI purchase' : `${LOAN_KINDS.find(x => x.id === k)!.label} loan`);
    if (!this.existing() && k === 'home' && this.unit() === 'm' && this.months() <= 12) this.unit.set('y');
  }
  setUnit(u: 'y' | 'm'): void {
    if (u === this.unit()) return;
    const m = this.months();
    this.unit.set(u);
    this.tenure.set(u === 'y' ? Math.round((m / 12) * 10) / 10 : m);
  }
  setCustomEmi(on: boolean): void {
    this.customEmi.set(on);
    if (on && !this.emiInput()) this.emiInput.set(Math.round(this.formulaEmi()));
  }

  async save(): Promise<void> {
    this.touched.set(true);
    if (this.problems().length) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const mode = this.planMode();
      const plan: EmiPlanChoice = mode === 'link' ? { kind: 'link', planId: this.linkId() } : { kind: mode };
      const s = await this.loanLedger.saveLoan(this.existing(), {
        name: this.name(), lender: this.lender(), kind: this.kind(),
        principal: Number(this.principal()), rate: Number(this.rate()) || 0, tenureMonths: this.months(),
        firstEmiDate: this.first(), emi: this.emi(), paidBefore: Math.round(Number(this.paidBefore()) || 0),
        account: parseRef(this.accountKey()), notes: this.notes(), autopay: this.autopay(),
      }, plan, this.plans());
      this.undo.offer(this.existing() ? `Updated ${this.name().trim()}` : `Added ${this.name().trim()} · ${inr(Number(this.principal()))}`, s.undo);
      this.ref.close(true);
    } catch (e: any) {
      console.error('[LoanForm] save failed', e);
      this.error.set(e?.message && !e?.code ? e.message : 'Could not save. Check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }
}

