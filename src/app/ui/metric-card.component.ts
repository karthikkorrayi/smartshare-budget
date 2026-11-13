import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from './icon.component';

/** KPI tile: icon, label, big value, one-line explanation, optional trend chip. */
@Component({
  selector: 'app-metric',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="m" [class.feature]="feature()">
      <div class="top">
        <span class="icon-tile" [class]="'icon-tile ' + tone()"><app-icon [name]="icon()" [size]="18" /></span>
        @if (trend(); as t) {
          <span class="badge" [class.pos]="t.good" [class.neg]="!t.good">
            <app-icon [name]="t.up ? 'trending-up' : 'trending-down'" [size]="13" /> {{ t.text }}
          </span>
        }
      </div>
      <div class="label">{{ label() }}</div>
      <div class="value num" [class.neg]="negative()">{{ value() }}</div>
      @if (hint()) { <div class="hint">{{ hint() }}</div> }
      <ng-content />
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .m { height: 100%; padding: 16px 18px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
         box-shadow: var(--shadow-sm); display: flex; flex-direction: column; min-width: 0; transition: transform .2s var(--ease), box-shadow .2s; }
    .m:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
    .label { font-size: 12.5px; font-weight: 600; color: var(--text-3); }
    .value { margin-top: 4px; font-size: 24px; font-weight: 700; letter-spacing: -0.03em; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .value.neg { color: var(--neg); }
    .hint { margin-top: 4px; font-size: 12px; color: var(--text-3); }
    .feature { background: var(--art-bank); border-color: transparent; color: #fff; position: relative; overflow: hidden; }
    .feature::after { content: ''; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px; border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, rgba(255,255,255,.35), rgba(255,255,255,0) 70%); pointer-events: none; }
    .feature .label, .feature .hint { color: rgba(255,255,255,.82); }
    .feature .value { color: #fff; font-size: 30px; }
    .feature .icon-tile { background: rgba(255,255,255,.18); color: #fff; }
    @media (max-width: 640px) { .value { font-size: 20px; } .feature .value { font-size: 26px; } }
  `],
})
export class MetricCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input<string>('');
  readonly icon = input<string>('circle-dollar-sign');
  readonly tone = input<'accent' | 'pos' | 'neg' | 'warn' | 'info' | ''>('accent');
  readonly negative = input(false);
  readonly feature = input(false);
  readonly trend = input<{ up: boolean; good: boolean; text: string } | null>(null);
}
