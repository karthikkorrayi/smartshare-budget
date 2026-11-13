import { Pipe, PipeTransform } from '@angular/core';
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
