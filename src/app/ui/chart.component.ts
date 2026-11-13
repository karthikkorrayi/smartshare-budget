import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { ThemeService, cssVar } from '../core/theme.service';
import { moneyShort } from './money.pipe';
import { inr } from '../utils/analytics.util';

Chart.register(...registerables);

export interface ChartSeries {
  label: string;
  data: number[];
  /** CSS variable name, e.g. '--c1' or '--pos'. */
  color: string;
  kind?: 'bar' | 'line';
  dashed?: boolean;
  fill?: boolean;
}

export interface ChartPick {
  index: number;
  datasetIndex: number;
  label: string;
}

/**
 * Theme-aware Chart.js wrapper. Colours come from CSS variables and are re-read when the theme
 * changes; data updates animate instead of re-creating the chart. Clicking a bar / slice emits (pick).
 */
@Component({
  selector: 'app-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="wrap" [style.height.px]="height()"><canvas #c [attr.aria-label]="ariaLabel()" role="img"></canvas></div>`,
  styles: [`:host { display: block; min-width: 0; } .wrap { position: relative; width: 100%; }`],
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  readonly type = input<'bar' | 'line' | 'doughnut'>('bar');
  readonly labels = input<string[]>([]);
  readonly series = input<ChartSeries[]>([]);
  readonly height = input(260);
  readonly stacked = input(false);
  readonly legend = input(false);
  readonly highlight = input<number | null>(null);
  readonly ariaLabel = input('Chart');
  readonly cutout = input('72%');
  readonly pick = output<ChartPick>();

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private theme = inject(ThemeService);
  private chart: Chart | null = null;
  private builtType: string | null = null;
  private ready = false;

  constructor() {
    effect(() => {
      // Track inputs + theme.
      this.type(); this.labels(); this.series(); this.stacked(); this.legend(); this.highlight(); this.theme.version();
      if (this.ready) untracked(() => this.render());
    });
  }

  ngAfterViewInit(): void {
    this.ready = true;
    // Wait one frame so CSS variables for the new theme are applied.
    requestAnimationFrame(() => this.render());
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  private render(): void {
    const type = this.type();
    const cfg = this.config();
    if (this.chart && this.builtType === type) {
      this.chart.data = cfg.data as any;
      this.chart.options = cfg.options as any;
      this.chart.update();
      return;
    }
    this.chart?.destroy();
    this.chart = new Chart(this.canvas().nativeElement, cfg);
    this.builtType = type;
  }

  private config(): ChartConfiguration {
    const type = this.type();
    const text = cssVar('--chart-text') || '#64748b';
    const grid = cssVar('--chart-grid') || 'rgba(100,116,139,.15)';
    const surface = cssVar('--surface') || '#fff';
    const font = { family: 'Inter, system-ui, sans-serif', size: 11 };
    const hl = this.highlight();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const tooltip = {
      backgroundColor: cssVar('--surface-raised') || '#fff',
      titleColor: cssVar('--text') || '#0f172a',
      bodyColor: cssVar('--text-2') || '#334155',
      borderColor: cssVar('--border-strong') || '#cbd5e1',
      borderWidth: 1,
      padding: 10,
      cornerRadius: 10,
      boxPadding: 4,
      usePointStyle: true,
      titleFont: { ...font, size: 12, weight: 600 as const },
      bodyFont: { ...font, size: 12 },
      callbacks: {
        label: (c: any) => ` ${c.dataset.label ?? c.label}: ${inr(Number(c.raw) || 0)}`,
      },
    };

    const onClick = (_e: any, els: any[]) => {
      if (!els?.length) return;
      const { index, datasetIndex } = els[0];
      this.pick.emit({ index, datasetIndex, label: this.labels()[index] ?? '' });
    };

    if (type === 'doughnut') {
      const s = this.series()[0];
      const colors = (s?.data ?? []).map((_, i) => cssVar(`--c${(i % 8) + 1}`));
      return {
        type: 'doughnut',
        data: {
          labels: this.labels(),
          datasets: [{ label: s?.label ?? '', data: s?.data ?? [], backgroundColor: colors, borderColor: surface, borderWidth: 2, hoverOffset: 6, spacing: 1 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: this.cutout(),
          animation: reduce ? false : { duration: 500 },
          plugins: { legend: { display: false }, tooltip },
          onClick,
          onHover: (e: any, els: any[]) => ((e.native?.target as HTMLElement).style.cursor = els.length ? 'pointer' : 'default'),
        } as any,
      };
    }

    const datasets = this.series().map(s => {
      const c = cssVar(s.color) || '#0d9488';
      const kind = s.kind ?? (type === 'line' ? 'line' : 'bar');
      if (kind === 'line') {
        return {
          type: 'line' as const,
          label: s.label,
          data: s.data,
          borderColor: c,
          backgroundColor: s.fill ? alpha(c, 0.12) : c,
          fill: !!s.fill,
          borderWidth: 2.25,
          borderDash: s.dashed ? [5, 5] : [],
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: c,
          order: 0,
        };
      }
      return {
        type: 'bar' as const,
        label: s.label,
        data: s.data,
        backgroundColor: s.data.map((_, i) => (hl === null || hl === i ? c : alpha(c, 0.35))),
        hoverBackgroundColor: c,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 28,
        categoryPercentage: 0.7,
        barPercentage: 0.9,
        order: 1,
      };
    });

    return {
      type: 'bar',
      data: { labels: this.labels(), datasets: datasets as any },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 450 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: this.legend(),
            position: 'bottom',
            labels: { color: text, font, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14 },
          },
          tooltip,
        },
        scales: {
          x: {
            stacked: this.stacked(),
            grid: { display: false },
            border: { display: false },
            ticks: { color: text, font, maxRotation: 0, autoSkip: true, autoSkipPadding: 10 },
          },
          y: {
            stacked: this.stacked(),
            beginAtZero: true,
            grid: { color: grid },
            border: { display: false },
            ticks: { color: text, font, maxTicksLimit: 5, callback: (v: any) => moneyShort(Number(v)) },
          },
        },
        onClick,
        onHover: (e: any, els: any[]) => ((e.native?.target as HTMLElement).style.cursor = els.length ? 'pointer' : 'default'),
      } as any,
    };
  }
}

function alpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map(x => x.trim());
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}
