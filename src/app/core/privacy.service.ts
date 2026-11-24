import { Injectable, computed, signal } from '@angular/core';

/** What a hidden amount looks like everywhere in the app. */
export const MASK = '₹ ******';

/**
 * Balance visibility. Every balance starts hidden each time the app opens; each one is revealed
 * on its own by its eye button, keyed by what it is ("wealth", "bank:<id>", "card:<id>"…), so the
 * same account is shown or hidden the same way on every screen. Nothing is stored: closing or
 * reloading the app hides everything again.
 */
@Injectable({ providedIn: 'root' })
export class PrivacyService {
  private readonly revealed = signal<ReadonlySet<string>>(new Set());

  /** True when at least one amount is showing (drives the "Hide all" button). */
  readonly anyVisible = computed(() => this.revealed().size > 0);

  isVisible(key: string): boolean {
    return this.revealed().has(key);
  }

  toggle(key: string): void {
    this.revealed.update(s => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** True when every key in the list is showing. */
  allVisible(keys: readonly string[]): boolean {
    const r = this.revealed();
    return keys.length > 0 && keys.every(k => r.has(k));
  }

  /** Show or hide a whole group at once (the dashboard's single eye). */
  setMany(keys: readonly string[], visible: boolean): void {
    this.revealed.update(s => {
      const next = new Set(s);
      for (const k of keys) visible ? next.add(k) : next.delete(k);
      return next;
    });
  }

  hideAll(): void {
    this.revealed.set(new Set());
  }

  /** "₹12,345" when this key is revealed, otherwise the mask. */
  text(key: string, formatted: string): string {
    return this.isVisible(key) ? formatted : MASK;
  }
}
