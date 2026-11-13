import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let seq = 0;

export type EmptyArt = 'accounts' | 'transactions' | 'recurring' | 'bills' | 'lending' | 'range' | 'inbox' | 'chart' | 'offline';

/**
 * Friendly empty state with a small vector illustration (theme-aware: drawn with CSS variables).
 * Project an action button inside: <app-empty art="accounts" title="…" text="…"><button …/></app-empty>
 */
@Component({
  selector: 'app-empty',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty" [class.compact]="compact()">
      <svg class="art" viewBox="0 0 160 120" aria-hidden="true">
        <defs>
          <linearGradient [attr.id]="uid + 'a'" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="var(--accent)" stop-opacity=".95" />
            <stop offset="1" stop-color="var(--c2)" stop-opacity=".85" />
          </linearGradient>
          <linearGradient [attr.id]="uid + 'b'" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--surface)" />
            <stop offset="1" stop-color="var(--surface-2)" />
          </linearGradient>
        </defs>
        <ellipse cx="80" cy="104" rx="52" ry="7" fill="var(--surface-3)" />
        <circle cx="80" cy="56" r="46" fill="var(--accent-soft)" />
        @switch (art()) {
          @case ('accounts') {
            <rect x="42" y="40" width="76" height="48" rx="9" [attr.fill]="'url(#' + uid + 'a)'" />
            <rect x="34" y="30" width="76" height="48" rx="9" [attr.fill]="'url(#' + uid + 'b)'" stroke="var(--border-strong)" />
            <rect x="44" y="42" width="16" height="11" rx="2.5" fill="var(--c3)" opacity=".85" />
            <rect x="44" y="62" width="40" height="5" rx="2.5" fill="var(--border-strong)" />
            <circle cx="98" cy="64" r="6" fill="var(--accent)" opacity=".9" /><circle cx="90" cy="64" r="6" fill="var(--c3)" opacity=".8" />
          }
          @case ('recurring') {
            <rect x="46" y="28" width="68" height="64" rx="10" [attr.fill]="'url(#' + uid + 'b)'" stroke="var(--border-strong)" />
            <rect x="46" y="28" width="68" height="16" rx="10" [attr.fill]="'url(#' + uid + 'a)'" />
            <rect x="46" y="38" width="68" height="6" [attr.fill]="'url(#' + uid + 'a)'" />
            @for (c of grid; track $index) { <rect [attr.x]="56 + c[0] * 14" [attr.y]="52 + c[1] * 12" width="8" height="7" rx="2" [attr.fill]="c[2] ? 'var(--accent)' : 'var(--surface-3)'" /> }
            <circle cx="112" cy="84" r="14" fill="var(--surface)" stroke="var(--accent)" stroke-width="3" />
            <path d="M112 77v7l5 3" stroke="var(--accent)" stroke-width="3" fill="none" stroke-linecap="round" />
          }
          @case ('bills') {
            <path d="M54 26h52v66l-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5z" [attr.fill]="'url(#' + uid + 'b)'" stroke="var(--border-strong)" />
            <rect x="62" y="38" width="36" height="5" rx="2.5" fill="var(--accent)" />
            <rect x="62" y="50" width="28" height="4" rx="2" fill="var(--border-strong)" />
            <rect x="62" y="60" width="32" height="4" rx="2" fill="var(--border-strong)" />
            <circle cx="104" cy="80" r="13" [attr.fill]="'url(#' + uid + 'a)'" />
            <path d="M98 80l4 4 8-8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          }
          @case ('lending') {
            <rect x="40" y="34" width="54" height="40" rx="8" [attr.fill]="'url(#' + uid + 'b)'" stroke="var(--border-strong)" transform="rotate(-8 67 54)" />
            <rect x="66" y="42" width="54" height="40" rx="8" [attr.fill]="'url(#' + uid + 'a)'" transform="rotate(6 93 62)" />
            <circle cx="93" cy="62" r="9" fill="none" stroke="#fff" stroke-width="2.5" opacity=".9" />
            <path d="M52 48h22M52 56h14" stroke="var(--border-strong)" stroke-width="4" stroke-linecap="round" />
          }
          @case ('range') {
            <rect x="36" y="54" width="14" height="30" rx="4" fill="var(--surface-3)" />
            <rect x="56" y="40" width="14" height="44" rx="4" fill="var(--surface-3)" />
            <rect x="76" y="62" width="14" height="22" rx="4" fill="var(--surface-3)" />
            <rect x="96" y="46" width="14" height="38" rx="4" fill="var(--surface-3)" />
            <circle cx="104" cy="44" r="16" fill="var(--surface)" [attr.stroke]="'url(#' + uid + 'a)'" stroke-width="4" />
            <path d="M115 55l10 10" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" />
          }
          @case ('inbox') {
            <path d="M42 64l12-28h52l12 28v22a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6z" [attr.fill]="'url(#' + uid + 'b)'" stroke="var(--border-strong)" />
            <path d="M42 64h26l4 8h16l4-8h26" fill="none" stroke="var(--border-strong)" stroke-width="2" />
            <circle cx="80" cy="46" r="10" [attr.fill]="'url(#' + uid + 'a)'" />
            <path d="M75 46l4 4 6-7" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          }
          @case ('offline') {
            <path d="M48 70a32 32 0 0 1 64 0" fill="none" stroke="var(--border-strong)" stroke-width="6" stroke-linecap="round" />
            <path d="M60 72a20 20 0 0 1 40 0" fill="none" stroke="var(--text-4)" stroke-width="6" stroke-linecap="round" />
            <circle cx="80" cy="80" r="6" fill="var(--accent)" />
            <path d="M50 40l60 50" stroke="var(--neg)" stroke-width="5" stroke-linecap="round" />
          }
          @case ('chart') {
            <rect x="40" y="30" width="80" height="58" rx="10" [attr.fill]="'url(#' + uid + 'b)'" stroke="var(--border-strong)" />
            <path d="M50 76l16-16 12 8 22-24" fill="none" [attr.stroke]="'url(#' + uid + 'a)'" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="100" cy="44" r="5" fill="var(--accent)" />
          }
          @default {
            <rect x="44" y="30" width="72" height="60" rx="10" [attr.fill]="'url(#' + uid + 'b)'" stroke="var(--border-strong)" />
            <rect x="54" y="42" width="18" height="18" rx="5" [attr.fill]="'url(#' + uid + 'a)'" />
            <rect x="78" y="44" width="28" height="5" rx="2.5" fill="var(--border-strong)" />
            <rect x="78" y="53" width="18" height="4" rx="2" fill="var(--surface-3)" />
            <rect x="54" y="68" width="52" height="5" rx="2.5" fill="var(--surface-3)" />
            <rect x="54" y="78" width="36" height="5" rx="2.5" fill="var(--surface-3)" />
          }
        }
      </svg>
      <h3>{{ title() }}</h3>
      @if (text()) { <p>{{ text() }}</p> }
      <div class="actions"><ng-content /></div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 28px 16px; }
    .art { width: 150px; height: auto; margin-bottom: 8px; animation: float 6s ease-in-out infinite; }
    h3 { margin: 4px 0 0; font-size: 15px; font-weight: 650; }
    p { margin: 6px 0 0; max-width: 360px; font-size: 13px; color: var(--text-3); line-height: 1.5; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 14px; }
    .actions:empty { display: none; }
    .compact { padding: 14px 8px; }
    .compact .art { width: 110px; }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  `],
})
export class EmptyStateComponent {
  readonly uid = `eg${++seq}`;
  readonly art = input<EmptyArt | 'generic'>('generic');
  readonly title = input.required<string>();
  readonly text = input<string>('');
  readonly compact = input(false);
  readonly grid: [number, number, boolean][] = [[0, 0, false], [1, 0, true], [2, 0, false], [3, 0, false], [0, 1, false], [1, 1, false], [2, 1, true], [3, 1, false], [0, 2, true], [1, 2, false], [2, 2, false]];
}
