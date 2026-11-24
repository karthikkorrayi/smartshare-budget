import { Pipe, PipeTransform, inject } from '@angular/core';
import { PrivacyService } from '../core/privacy.service';
import { inr } from '../utils/analytics.util';

/** {{ 12345.5 | money }} → ₹12,346 ; {{ x | money:true }} keeps paise. Negative → −₹… */
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(v: number | null | undefined, decimals = false): string {
    return inr(Number(v) || 0, decimals);
  }
}

/** Compact: ₹1.2L, ₹3.4Cr, ₹12.5K — for chart axes and tight tiles. */
@Pipe({ name: 'moneyShort', standalone: true })
export class MoneyShortPipe implements PipeTransform {
  transform(v: number | null | undefined): string {
    return moneyShort(Number(v) || 0);
  }
}

export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${s}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${s}₹${trim(a / 1e3)}K`;
  return `${s}₹${Math.round(a)}`;
}
const trim = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''));

/**
 * Text-only form of a private balance (for places that can't hold a button, e.g. inside an option):
 *   {{ a.balance | privateMoney: a.key }}  → "₹ ******" until that key is revealed by its eye button.
 */
@Pipe({ name: 'privateMoney', standalone: true, pure: false })
export class PrivateMoneyPipe implements PipeTransform {
  private privacy = inject(PrivacyService);
  transform(v: number | null | undefined, key: string, decimals = false): string {
    return this.privacy.text(key, inr(Number(v) || 0, decimals));
  }
}
