import { Timestamp } from '@angular/fire/firestore';

/** Firestore Timestamp | Date | null → Date | null. serverTimestamp() reads as null until confirmed. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (v && typeof (v as any).toDate === 'function') return (v as any).toDate();
  return null;
}

/** Deep-converts Date values in a plain object to Firestore Timestamps (for map fields). */
export function datesToTimestamps<T extends Record<string, any>>(obj: T): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v instanceof Date ? Timestamp.fromDate(v) : v;
  }
  return out;
}

/** Deep-converts Timestamps in a plain object to Dates. */
export function timestampsToDates<T = Record<string, any>>(obj: Record<string, any> | null | undefined): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj ?? {})) out[k] = toDate(v) ?? v;
  return out as T;
}

/** Firestore batches max out at 500 writes. */
export function chunk<T>(arr: T[], size = 450): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
