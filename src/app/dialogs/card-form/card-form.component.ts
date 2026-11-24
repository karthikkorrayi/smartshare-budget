import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  AUTOPAY_LABEL,
  AUTOPAY_MODES,
  AutopayMode,
  CARD_ARTS,
  CARD_BENEFITS,
  CARD_DEFAULTS,
  CARD_NETWORKS,
  CARD_TIERS,
  Card,
  CardArt,
  CardInput,
  CardNetwork,
  CardTier,
  NETWORK_LABEL,
  REWARD_LABEL,
  REWARD_TYPES,
  RewardType,
  TIER_LABEL,
  benefitLabel,
  billingCycle,
} from '../../models/card.model';
import { CardsService } from '../../services/cards.service';
import { UndoService } from '../../services/undo.service';
import { IconComponent } from '../../ui/icon.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';
import { DateFieldComponent } from '../../ui/date-field.component';
import { checkDay, fromDateInput, toDateInput, todayInput } from '../../utils/date-input.util';
import { inr } from '../../utils/analytics.util';

export interface CardFormData {
  card?: Card;
  /** Open on this step (0–3), e.g. "Edit rewards" from the card page. */
  step?: number;
}

const STEPS = [
  { id: 'card', label: 'Card', icon: 'credit-card' },
  { id: 'limits', label: 'Limits & billing', icon: 'calendar-days' },
  { id: 'costs', label: 'Costs & rewards', icon: 'percent' },
  { id: 'settings', label: 'Settings', icon: 'sliders-horizontal' },
] as const;

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/**
 * Add / edit a credit card in four steps with a live card preview.
 * New cards go step by step (each step is checked before moving on); when editing, every step is
 * reachable from the step bar and changes can be saved from any step.
 */
@Component({
  selector: 'app-card-form',
  standalone: true,
  imports: [IconComponent, FormsModule, DatePipe, SelectComponent, DateFieldComponent],
  templateUrl: './card-form.component.html',
  styleUrl: './card-form.component.scss',
})
export class CardFormComponent {
  private dialogRef = inject(MatDialogRef<CardFormComponent>);
  private cards = inject(CardsService);
  private undo = inject(UndoService);
  data: CardFormData = inject(MAT_DIALOG_DATA, { optional: true }) ?? {};

  readonly steps = STEPS;
  readonly networks = CARD_NETWORKS;
  readonly networkLabel = NETWORK_LABEL;
  readonly netShort: Record<CardNetwork, string> = { visa: 'VISA', mastercard: 'MC', rupay: 'RuPay', amex: 'AMEX', diners: 'Diners', other: '•••' };
  readonly arts = CARD_ARTS;
  readonly rewardTypes = REWARD_TYPES;
  readonly rewardInfo = REWARD_LABEL;
  readonly benefitList = CARD_BENEFITS;
  readonly autopayModes = AUTOPAY_MODES;
  readonly autopayLabel = AUTOPAY_LABEL;
  readonly benefitLabel = benefitLabel;
  readonly tierLabel = TIER_LABEL;
  readonly alertSteps = [0, 30, 50, 70, 90];
  readonly today = todayInput();

  readonly tierOptions: SelectOption[] = [{ value: null, label: 'Not specified' }, ...CARD_TIERS.map(t => ({ value: t, label: TIER_LABEL[t] }))];
  readonly monthOptions: SelectOption[] = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: `${String(i + 1).padStart(2, '0')} · ${new Date(2000, i, 1).toLocaleDateString('en-IN', { month: 'long' })}`,
  }));
  readonly yearOptions: SelectOption[] = Array.from({ length: 16 }, (_, i) => {
    const y = new Date().getFullYear() - 3 + i;
    return { value: y, label: String(y) };
  });
  readonly dayOptions: SelectOption[] = Array.from({ length: 31 }, (_, i) => ({
    value: i + 1,
    label: `${ordinal(i + 1)} of every month`,
    hint: i + 1 > 28 ? 'Shorter months use their last day' : undefined,
  }));

  isEdit = !!this.data.card;
  step = signal(Math.min(3, Math.max(0, this.data.step ?? 0)));
  /** Furthest step reached (new cards can't skip ahead). */
  reached = signal(this.isEdit ? 3 : this.step());
  saving = signal(false);
  errors = signal<string[]>([]);
  customBenefit = '';

  form: CardInput = this.initial();
  /** Bound to <app-date>; converted on save. */
  openingAsOfInput = toDateInput(this.data.card?.openingAsOf ?? new Date());
  rewardsAsOfInput = toDateInput(this.data.card?.rewardsAsOf ?? new Date());
  /** Signals the template can react to for the live previews. */
  rev = signal(0);

  readonly cycle = computed(() => {
    this.rev();
    const f = this.form;
    if (!f.statementDay || !f.dueDay) return null;
    return billingCycle({ statementDay: f.statementDay, dueDay: f.dueDay });
  });

  readonly annualRate = computed(() => {
    this.rev();
    const m = Number(this.form.interestMonthly) || 0;
    return m > 0 ? { simple: Math.round(m * 12 * 10) / 10, effective: Math.round((Math.pow(1 + m / 100, 12) - 1) * 1000) / 10 } : null;
  });

  readonly rewardHint = computed(() => {
    this.rev();
    const f = this.form;
    if (f.rewardType === 'none' || !(Number(f.rewardRate) > 0)) return '';
    if (f.rewardType === 'cashback') return `₹10,000 spent → ${inr((10000 * Number(f.rewardRate)) / 100)} back`;
    const units = Math.floor(100 * Number(f.rewardRate));
    const worth = Number(f.rewardValue) > 0 ? ` (worth ${inr(units * Number(f.rewardValue))})` : '';
    return `₹10,000 spent → ${units.toLocaleString('en-IN')} ${REWARD_LABEL[f.rewardType].unit}${worth}`;
  });

  readonly summary = computed(() => {
    this.rev();
    const f = this.form;
    const rows: { label: string; value: string }[] = [
      { label: 'Card', value: `${f.nickname || f.bankName || '—'} ••${f.lastFourDigits || '????'}` },
      { label: 'Network / tier', value: [f.network ? NETWORK_LABEL[f.network] : '', f.tier ? TIER_LABEL[f.tier] : ''].filter(Boolean).join(' · ') || '—' },
      { label: 'Credit limit', value: Number(f.creditLimit) > 0 ? inr(Number(f.creditLimit)) : 'Not set' },
      { label: 'Billing', value: f.statementDay && f.dueDay ? `Statement ${ordinal(f.statementDay)}, due ${ordinal(f.dueDay)}` : '—' },
      { label: 'Interest', value: Number(f.interestMonthly) > 0 ? `${f.interestMonthly}% per month` : 'Not set' },
      { label: 'Annual fee', value: Number(f.annualFee) > 0 ? inr(Number(f.annualFee)) + (Number(f.feeWaiverSpend) > 0 ? ` (waived above ${inr(Number(f.feeWaiverSpend))})` : '') : 'None / not set' },
      { label: 'Rewards', value: f.rewardType === 'none' ? 'None' : `${REWARD_LABEL[f.rewardType].label}${Number(f.rewardRate) > 0 ? ` · ${f.rewardRate}${f.rewardType === 'cashback' ? '%' : ' per ₹100'}` : ''}` },
      { label: 'Benefits', value: f.benefits.length ? `${f.benefits.length} tagged` : 'None' },
    ];
    return rows;
  });

  touch(): void {
    this.rev.update(v => v + 1);
  }

  goTo(i: number): void {
    if (i === this.step()) return;
    if (i > this.step() && !this.isEdit) {
      // Moving forward on a new card: check each step in between.
      for (let s = this.step(); s < i; s++) {
        const problems = this.validateStep(s);
        if (problems.length) {
          this.step.set(s);
          this.errors.set(problems);
          return;
        }
      }
    }
    if (i <= this.reached() || this.isEdit) {
      this.errors.set([]);
      this.step.set(i);
    }
  }

  next(): void {
    const problems = this.validateStep(this.step());
    this.errors.set(problems);
    if (problems.length) return;
    const n = Math.min(3, this.step() + 1);
    this.reached.update(r => Math.max(r, n));
    this.step.set(n);
  }

  back(): void {
    this.errors.set([]);
    this.step.set(Math.max(0, this.step() - 1));
  }

  setNetwork(n: CardNetwork): void {
    this.form.network = this.form.network === n ? null : n;
    this.touch();
  }
  setArt(a: CardArt): void {
    this.form.art = a;
    this.touch();
  }
  setReward(t: RewardType): void {
    this.form.rewardType = t;
    this.touch();
  }
  setAutopay(m: AutopayMode): void {
    this.form.autopay = m;
  }
  setTier(t: CardTier | null): void {
    this.form.tier = t;
    this.touch();
  }

  hasBenefit(id: string): boolean {
    return this.form.benefits.includes(id);
  }
  toggleBenefit(id: string): void {
    this.form.benefits = this.hasBenefit(id) ? this.form.benefits.filter(b => b !== id) : [...this.form.benefits, id];
    this.touch();
  }
  addCustomBenefit(): void {
    const v = this.customBenefit.trim().slice(0, 40);
    if (v && !this.form.benefits.includes(v) && this.form.benefits.length < 20) this.form.benefits = [...this.form.benefits, v];
    this.customBenefit = '';
    this.touch();
  }
  customBenefits(): string[] {
    return this.form.benefits.filter(b => !CARD_BENEFITS.some(x => x.id === b));
  }

  /** Digits only, keeps the LAST four — pasting a full number can't store it. */
  onLastFour(value: string): void {
    this.form.lastFourDigits = (value ?? '').replace(/\D/g, '').slice(-4);
    this.touch();
  }

  ordinal = ordinal;

  unitTitle(): string {
    const u = REWARD_LABEL[this.form.rewardType].unit;
    return u.charAt(0).toUpperCase() + u.slice(1);
  }
  unitSingular(): string {
    return REWARD_LABEL[this.form.rewardType].unit.replace(/s$/, '');
  }

  close(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    const problems = [0, 1, 2, 3].flatMap(s => this.validateStep(s));
    this.errors.set(problems);
    if (problems.length) {
      const first = [0, 1, 2, 3].find(s => this.validateStep(s).length) ?? 0;
      this.step.set(first);
      return;
    }
    const input: CardInput = {
      ...this.form,
      openingAsOf: Number(this.form.openingOutstanding) > 0 ? fromDateInput(this.openingAsOfInput) : this.form.openingAsOf,
      rewardsAsOf: this.form.rewardType !== 'none' && Number(this.form.rewardBalance) > 0 ? fromDateInput(this.rewardsAsOfInput) : null,
    };
    if (Number(input.openingOutstanding) > 0 && input.openingAsOf) {
      // Store at noon so the day can't shift in UTC readers.
      const d = input.openingAsOf;
      input.openingAsOf = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    }
    this.saving.set(true);
    try {
      if (this.isEdit) {
        const b = this.data.card!;
        await this.cards.update(b.id, input);
        this.undo.offer(`Updated card ••${b.lastFourDigits}`, () => this.cards.update(b.id, CardsService.inputOf(b)));
      } else {
        const ref = await this.cards.add(input);
        this.undo.offer(`Added card ••${input.lastFourDigits}`, () => this.cards.deleteWithHistory(ref.id));
      }
      this.dialogRef.close(true);
    } catch (err: any) {
      console.error('[CardForm] save failed', err);
      this.errors.set([
        err?.code === 'permission-denied'
          ? 'The server rejected these values. Check every step and try again.'
          : 'Could not save the card. Check your connection and try again.',
      ]);
    } finally {
      this.saving.set(false);
    }
  }

  validateStep(s: number): string[] {
    const f = this.form;
    const out: string[] = [];
    const nonNeg = (v: unknown, label: string) => {
      if (v !== null && v !== '' && v !== undefined && !(Number(v) >= 0)) out.push(`${label} can't be negative.`);
    };
    if (s === 0) {
      if (!f.bankName.trim()) out.push('Bank name is required.');
      if (!f.cardholderName.trim()) out.push("Cardholder's name is required.");
      if (!/^\d{4}$/.test(f.lastFourDigits)) out.push('Enter exactly the last 4 digits.');
      if (!Number(f.expiryMonth) || !Number(f.expiryYear)) out.push('Pick the expiry month and year.');
    }
    if (s === 1) {
      nonNeg(f.creditLimit, 'Credit limit');
      nonNeg(f.cashLimit, 'Cash limit');
      nonNeg(f.openingOutstanding, 'Outstanding');
      if (Number(f.creditLimit) > 0 && Number(f.cashLimit) > Number(f.creditLimit)) out.push("Cash limit can't be more than the credit limit.");
      if (!Number(f.statementDay)) out.push('Pick the statement day.');
      if (!Number(f.dueDay)) out.push('Pick the payment due day.');
      if (Number(f.statementDay) && Number(f.statementDay) === Number(f.dueDay)) out.push('The due day must differ from the statement day.');
      if (Number(f.openingOutstanding) > 0) {
        const p = checkDay(this.openingAsOfInput, { label: 'the "as of" date', notFuture: true });
        if (p) out.push(p);
      }
    }
    if (s === 2) {
      if (Number(f.interestMonthly) > 10) out.push('Interest is per MONTH — usually between 2% and 4%.');
      nonNeg(f.interestMonthly, 'Interest');
      nonNeg(f.annualFee, 'Annual fee');
      nonNeg(f.feeWaiverSpend, 'Waiver spend');
      nonNeg(f.lateFee, 'Late fee');
      if (Number(f.cashAdvanceFeePct) > 10 || Number(f.forexMarkupPct) > 10) out.push('Fee percentages above 10% look wrong.');
      if (f.rewardType === 'cashback' && Number(f.rewardRate) > 100) out.push("Cashback can't be more than 100%.");
      nonNeg(f.rewardRate, 'Reward rate');
      nonNeg(f.rewardBalance, 'Reward balance');
      nonNeg(f.rewardValue, 'Value per point');
    }
    if (s === 3) {
      nonNeg(f.dailySpendingLimit, 'Daily limit');
    }
    return out;
  }

  private initial(): CardInput {
    const c = this.data.card;
    if (c) return { ...CardsService.inputOf(c), benefits: [...c.benefits] };
    return {
      cardholderName: '',
      bankName: '',
      nickname: '',
      lastFourDigits: '',
      expiryMonth: 0,
      expiryYear: 0,
      statementDay: 0,
      dueDay: 0,
      status: 'Active',
      dailySpendingLimit: 0,
      ...CARD_DEFAULTS,
      // Empty boxes (not "0") for amounts the user hasn't entered yet; saving treats empty as 0.
      ...(Object.fromEntries(
        ['creditLimit', 'cashLimit', 'openingOutstanding', 'interestMonthly', 'annualFee', 'feeWaiverSpend', 'lateFee',
         'cashAdvanceFeePct', 'forexMarkupPct', 'rewardRate', 'rewardBalance', 'rewardValue', 'dailySpendingLimit'].map(k => [k, null])
      ) as any),
      benefits: [],
    };
  }
}
