import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** SmartShare Budget mark: two stacked coins forming an upward chart inside a rounded tile. */
@Component({
  selector: 'app-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 48 48" role="img" aria-label="SmartShare Budget">
      <defs>
        <linearGradient id="ssb-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#14b8a6" />
          <stop offset="1" stop-color="#0f766e" />
        </linearGradient>
        <linearGradient id="ssb-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".35" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="url(#ssb-g)" />
      <rect width="48" height="24" rx="13" fill="url(#ssb-h)" />
      <rect x="11" y="27" width="6" height="10" rx="2" fill="#fff" opacity=".7" />
      <rect x="21" y="21" width="6" height="16" rx="2" fill="#fff" opacity=".85" />
      <rect x="31" y="14" width="6" height="23" rx="2" fill="#fff" />
      <path d="M10 22l9-6 7 4 11-9" stroke="#ccfbf1" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
  styles: [`:host { display: inline-flex; line-height: 0; flex-shrink: 0; } svg { filter: drop-shadow(0 4px 10px rgba(13,148,136,.35)); }`],
})
export class LogoComponent {
  readonly size = input(36);
}
