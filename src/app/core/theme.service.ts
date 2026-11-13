import { Injectable, computed, signal } from '@angular/core';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'ssb_theme';

/**
 * Light / Dark / System theme. The choice is kept in localStorage (per device), applied as
 * <html data-theme> before Angular boots (see the inline script in index.html) so there's no flash.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly pref = signal<ThemePref>(read());
  private systemDark = signal(matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  readonly resolved = computed<'light' | 'dark'>(() => (this.pref() === 'system' ? (this.systemDark() ? 'dark' : 'light') : (this.pref() as 'light' | 'dark')));
  /** Bumped whenever the effective theme changes (charts re-read CSS variables). */
  readonly version = signal(0);

  constructor() {
    const mq = matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', e => {
      this.systemDark.set(e.matches);
      this.apply();
    });
    this.apply();
  }

  set(pref: ThemePref): void {
    this.pref.set(pref);
    try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable */ }
    this.apply();
  }

  cycle(): void {
    const order: ThemePref[] = ['light', 'dark', 'system'];
    this.set(order[(order.indexOf(this.pref()) + 1) % order.length]);
  }

  private apply(): void {
    const t = this.resolved();
    const root = document.documentElement;
    root.setAttribute('data-theme', t);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0b0d12' : '#f6f7f9');
    this.version.update(v => v + 1);
  }
}

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Reads a CSS custom property from :root (used by Chart.js, which can't use var()). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
