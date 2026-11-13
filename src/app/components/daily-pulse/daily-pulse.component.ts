import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SpendingService } from '../../services/spending.service';
import { SettingsService } from '../../services/settings.service';
import { AuthService } from '../../services/auth.service';
import { DEFAULT_SETTINGS } from '../../models/settings.model';
import { SpendEntry, dayKey, summarize } from '../../utils/spending.util';
import { IconComponent } from '../../ui/icon.component';

const DISMISS_KEY = 'ssb_pulse_dismissed';

/** Dashboard card: today's spend vs limit, no-spend + within-limit streaks, one appreciation line. */
@Component({
  selector: 'app-daily-pulse',
  standalone: true,
  imports: [IconComponent, DecimalPipe, RouterLink],
  template: `
    @if (s(); as p) {
      <section class="pulse" [class]="'tone-' + p.tone" aria-label="Today's spending">
        <div class="today">
          <span class="label">Spent today</span>
          <span class="amount">₹{{ p.today | number: '1.0-0' }}</span>
          @if (p.limit) {
            <div class="bar" role="progressbar" [attr.aria-valuenow]="p.percent" aria-valuemin="0" aria-valuemax="100">
              <span [style.width.%]="p.percent > 100 ? 100 : p.percent"></span>
            </div>
            <span class="sub">
              @if (p.tone === 'over') { ₹{{ p.today - p.limit | number: '1.0-0' }} over the ₹{{ p.limit | number: '1.0-0' }} limit }
              @else { ₹{{ p.remaining | number: '1.0-0' }} left of ₹{{ p.limit | number: '1.0-0' }} }
            </span>
          } @else {
            <a class="sub link" routerLink="/profile" fragment="budget">Set a daily limit ›</a>
          }
        </div>

        <div class="streaks">
          <div class="streak">
            <span class="num">{{ p.noSpendStreak + (p.todayNoSpend ? 1 : 0) }}</span>
            <span class="what">no-spend day{{ p.noSpendStreak + (p.todayNoSpend ? 1 : 0) === 1 ? '' : 's' }} in a row</span>
          </div>
          @if (p.limit) {
            <div class="streak">
              <span class="num">{{ p.withinLimitStreak }}</span>
              <span class="what">day{{ p.withinLimitStreak === 1 ? '' : 's' }} within limit</span>
            </div>
          }
        </div>

        @if (celebrate() && p.message && !dismissed()) {
          <div class="message">
            <span class="icon"><app-icon [name]="p.message.icon" [size]="18" /></span>
            <span class="text">{{ p.message.text }}</span>
            <button class="close" (click)="dismiss()" aria-label="Dismiss for today"><app-icon name="x" [size]="14" /></button>
          </div>
        }
      </section>
    }
  `,
  styles: [`
    .pulse { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 14px 18px; margin: 0;
      padding: 16px 18px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: 0 6px 24px rgba(15,23,42,.04); }
    .today { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .label { font-size: 12px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-3); }
    .amount { font-size: 28px; font-weight: 800; letter-spacing: -.6px; color: var(--text); }
    .bar { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
    .bar span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width .3s; }
    .tone-warn .bar span { background: var(--warn); }
    .tone-over { border-color: var(--neg); }
    .tone-over .bar span { background: var(--neg); }
    .tone-over .amount { color: var(--neg); }
    .sub { font-size: 13px; color: var(--text-2); }
    .link { color: var(--accent-strong); font-weight: 650; text-decoration: none; }
    .streaks { display: flex; gap: 10px; align-items: stretch; }
    .streak { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 10px 12px; border-radius: 14px; background: var(--accent-soft); }
    .num { font-size: 24px; font-weight: 800; color: var(--accent-strong); line-height: 1; }
    .what { font-size: 12px; color: var(--text-2); }
    .message { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); }
    .tone-over .message { background: var(--neg-soft); }
    .icon { font-size: 20px; }
    .text { flex: 1; font-size: 14px; font-weight: 600; color: var(--text); }
    .close { border: none; background: none; color: var(--text-4); font-size: 14px; cursor: pointer; padding: 4px 6px; }
    @media (max-width: 640px) { .pulse { grid-template-columns: 1fr; } .amount { font-size: 24px; } }
  `],
})
export class DailyPulseComponent {
  private spending = inject(SpendingService);
  private settingsService = inject(SettingsService);
  private auth = inject(AuthService);

  private entries = toSignal(this.spending.recent$);
  private settings = toSignal(this.settingsService.settings$, { initialValue: DEFAULT_SETTINGS });
  private dismissedKey = signal(readDismissed());

  celebrate = computed(() => this.settings().celebrate);
  dismissed = computed(() => this.dismissedKey() === dayKey(new Date()));

  s = computed(() => {
    const entries: SpendEntry[] | undefined = this.entries();
    if (!entries) return null;
    const created = this.auth.account()?.createdAt ?? new Date();
    return summarize(entries, this.settings().dailyLimit, new Date(), created);
  });

  dismiss(): void {
    const k = dayKey(new Date());
    this.dismissedKey.set(k);
    try { localStorage.setItem(DISMISS_KEY, k); } catch { /* storage unavailable */ }
  }
}

function readDismissed(): string | null {
  try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
}
