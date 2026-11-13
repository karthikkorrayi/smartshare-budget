import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Shimmer placeholder. <app-skeleton h="18px" w="60%" /> or variant="card" / "row" / "chart". */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (variant()) {
      @case ('card') {
        <div class="sk-card" aria-hidden="true">
          <span class="skeleton" style="width:36px;height:36px;border-radius:11px"></span>
          <span class="skeleton" style="width:45%;height:12px;margin-top:14px"></span>
          <span class="skeleton" style="width:70%;height:24px;margin-top:10px"></span>
          <span class="skeleton" style="width:55%;height:10px;margin-top:10px"></span>
        </div>
      }
      @case ('row') {
        @for (i of rows(); track i) {
          <div class="sk-row" aria-hidden="true">
            <span class="skeleton" style="width:36px;height:36px;border-radius:10px"></span>
            <span style="flex:1;display:flex;flex-direction:column;gap:6px">
              <span class="skeleton" style="width:55%;height:12px"></span>
              <span class="skeleton" style="width:30%;height:10px"></span>
            </span>
            <span class="skeleton" style="width:64px;height:14px"></span>
          </div>
        }
      }
      @case ('chart') {
        <div class="sk-chart" [style.height]="h()" aria-hidden="true">
          @for (b of bars; track $index) { <span class="skeleton" [style.height.%]="b"></span> }
        </div>
      }
      @default {
        <span class="skeleton" [style.width]="w()" [style.height]="h()" aria-hidden="true"></span>
      }
    }
    <span class="sr-only">Loading…</span>
  `,
  styles: [`
    :host { display: block; }
    .sk-card { display: flex; flex-direction: column; padding: 18px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
    .sk-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
    .sk-chart { display: flex; align-items: flex-end; gap: 6%; padding: 8px 4px 0; }
    .sk-chart span { flex: 1; border-radius: 6px 6px 2px 2px; }
  `],
})
export class SkeletonComponent {
  readonly variant = input<'line' | 'card' | 'row' | 'chart'>('line');
  readonly w = input('100%');
  readonly h = input('14px');
  readonly count = input(4);
  rows = () => Array.from({ length: this.count() }, (_, i) => i);
  readonly bars = [40, 65, 52, 80, 45, 70, 58, 90, 62, 48];
}
