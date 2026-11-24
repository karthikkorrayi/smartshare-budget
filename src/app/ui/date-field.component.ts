import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { IconComponent } from './icon.component';
import { fromDateInput, toDateInput } from '../utils/date-input.util';

interface Cell {
  key: string; // YYYY-MM-DD or YYYY-MM
  label: string;
  inMonth: boolean;
  today: boolean;
  disabled: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Themed date (or month) picker. Value is a local calendar day 'YYYY-MM-DD' (or 'YYYY-MM' with
 * mode="month") — the same strings <input type="date"> used, so existing save code is unchanged.
 *   <app-date [(ngModel)]="form.date" [max]="today" [quick]="['today','yesterday']" />
 * Weeks start on Monday. Dates outside [min, max] can't be picked.
 */
@Component({
  selector: 'app-date',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateFieldComponent), multi: true }],
  template: `
    <button #trigger type="button" class="sel" [class.open]="open()" [class.compact]="compact()" [class.invalid]="invalid()"
            [disabled]="disabled()" (click)="toggle()" (keydown.arrowDown)="$event.preventDefault(); openPanel()"
            aria-haspopup="dialog" [attr.aria-expanded]="open()" [attr.aria-label]="(ariaLabel() || 'Date') + ': ' + (display() || 'not set')"
            [attr.id]="inputId() || null">
      <app-icon class="lead" [name]="mode() === 'month' ? 'calendar' : 'calendar-days'" [size]="16" />
      <span class="val" [class.ph]="!value()">{{ display() || placeholder() }}</span>
      @if (clearable() && value()) {
        <span class="clr" role="button" tabindex="-1" aria-label="Clear date" (click)="clear($event)"><app-icon name="x" [size]="14" /></span>
      }
    </button>

    <ng-template #panel>
      <div class="date-panel" [class.sheet]="sheet()" role="dialog" [attr.aria-label]="ariaLabel() || 'Choose a date'" (keydown)="onKey($event)">
        <div class="dp-head">
          <button type="button" class="nav" (click)="shift(-1)" [attr.aria-label]="mode() === 'month' ? 'Previous year' : 'Previous month'"><app-icon name="chevron-left" [size]="18" /></button>
          <button type="button" class="title" (click)="mode() === 'day' && view.set(view() === 'days' ? 'months' : 'days')">
            {{ view() === 'days' ? monthTitle() : cursorYear() }}
          </button>
          <button type="button" class="nav" (click)="shift(1)" [attr.aria-label]="mode() === 'month' ? 'Next year' : 'Next month'"><app-icon name="chevron-right" [size]="18" /></button>
        </div>
        @if (view() === 'days') {
          <div class="dow" aria-hidden="true">@for (d of dow; track d) { <span>{{ d }}</span> }</div>
          <div class="grid days" role="grid">
            @for (c of dayCells(); track c.key) {
              <button type="button" class="cell" [class.out]="!c.inMonth" [class.today]="c.today" [class.on]="c.key === value()"
                      [class.focus]="c.key === focusKey()" [disabled]="c.disabled" [attr.aria-pressed]="c.key === value()"
                      [attr.aria-label]="c.key" (click)="choose(c.key)">{{ c.label }}</button>
            }
          </div>
        } @else {
          <div class="grid months">
            @for (c of monthCells(); track c.key) {
              <button type="button" class="cell" [class.today]="c.today" [class.on]="isMonthOn(c.key)" [disabled]="c.disabled"
                      (click)="chooseMonth(c.key)">{{ c.label }}</button>
            }
          </div>
        }
        @if (quickOptions().length) {
          <div class="dp-quick">
            @for (q of quickOptions(); track q.key) {
              <button type="button" class="chip" [disabled]="q.disabled" (click)="choose(q.value)">{{ q.label }}</button>
            }
          </div>
        }
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .sel {
      width: 100%; min-height: 42px; display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 12px;
      border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text);
      font: inherit; font-size: 14px; text-align: left; cursor: pointer; transition: border-color .15s, box-shadow .15s;
    }
    .sel.compact { min-height: 36px; padding: 6px 8px 6px 10px; font-size: 13px; }
    .sel:hover:not(:disabled) { border-color: var(--text-4); }
    .sel:focus-visible, .sel.open { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
    .sel.invalid { border-color: var(--neg); }
    .sel:disabled { opacity: .55; cursor: not-allowed; }
    .lead { color: var(--text-3); }
    .val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .val.ph { color: var(--text-4); }
    .clr { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; color: var(--text-3); }
    .clr:hover { background: var(--surface-2); color: var(--text); }
  `],
})
export class DateFieldComponent implements ControlValueAccessor {
  private overlay = inject(Overlay);
  private vcr = inject(ViewContainerRef);

  readonly mode = input<'day' | 'month'>('day');
  /** 'YYYY-MM-DD' (or 'YYYY-MM' in month mode) */
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly placeholder = input('Pick a date');
  readonly ariaLabel = input('');
  readonly compact = input(false);
  readonly invalid = input(false);
  readonly clearable = input(false);
  readonly inputId = input('');
  /** Shortcut chips: 'today' | 'yesterday' | 'tomorrow' | 'in7' | 'in30' | 'monthEnd' */
  readonly quick = input<string[]>(['today']);
  /** Non-forms usage. */
  readonly dateChange = output<string>();

  private trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private panel = viewChild.required<TemplateRef<unknown>>('panel');

  readonly value = signal<string>('');
  readonly disabled = signal(false);
  readonly open = signal(false);
  readonly sheet = signal(false);
  readonly view = signal<'days' | 'months'>('days');
  /** First day of the month shown. */
  private cursor = signal(new Date());
  readonly focusKey = signal('');
  private ref: OverlayRef | null = null;
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  readonly dow = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  readonly cursorYear = computed(() => this.cursor().getFullYear());
  readonly monthTitle = computed(() => this.cursor().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));

  readonly display = computed(() => {
    const v = this.value();
    if (!v) return '';
    if (this.mode() === 'month') {
      const [y, m] = v.split('-').map(Number);
      return y && m ? `${MONTHS[m - 1]} ${y}` : '';
    }
    const d = fromDateInput(v);
    if (!d) return '';
    const wd = d.toLocaleDateString('en-IN', { weekday: 'short' });
    return `${wd}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  });

  readonly dayCells = computed<Cell[]>(() => {
    const c = this.cursor();
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
    const today = toDateInput(new Date());
    const out: Cell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = toDateInput(d);
      out.push({ key, label: String(d.getDate()), inMonth: d.getMonth() === c.getMonth(), today: key === today, disabled: !this.allowed(key) });
    }
    return out;
  });

  readonly monthCells = computed<Cell[]>(() => {
    const y = this.cursor().getFullYear();
    const now = new Date();
    return MONTHS.map((label, i) => {
      const key = `${y}-${String(i + 1).padStart(2, '0')}`;
      return { key, label, inMonth: true, today: y === now.getFullYear() && i === now.getMonth(), disabled: !this.monthAllowed(key) };
    });
  });

  readonly quickOptions = computed(() => {
    if (this.mode() === 'month') return [];
    const t = new Date();
    const at = (days: number) => toDateInput(new Date(t.getFullYear(), t.getMonth(), t.getDate() + days));
    const defs: Record<string, [string, string]> = {
      today: ['Today', at(0)],
      yesterday: ['Yesterday', at(-1)],
      tomorrow: ['Tomorrow', at(1)],
      in7: ['In 7 days', at(7)],
      in30: ['In 30 days', at(30)],
      monthEnd: ['Month end', toDateInput(new Date(t.getFullYear(), t.getMonth() + 1, 0))],
    };
    return this.quick()
      .filter(k => defs[k])
      .map(k => ({ key: k, label: defs[k][0], value: defs[k][1], disabled: !this.allowed(defs[k][1]) }));
  });

  // ── ControlValueAccessor ────────────────────────────────────
  writeValue(v: string | null): void {
    this.value.set(v ?? '');
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
  }

  toggle(): void {
    this.open() ? this.close(true) : this.openPanel();
  }

  openPanel(): void {
    if (this.open() || this.disabled()) return;
    const v = this.value();
    const base = this.mode() === 'month' ? (v ? fromDateInput(v + '-01') : null) : fromDateInput(v);
    const anchor = base ?? this.clampToRange(new Date());
    this.cursor.set(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    this.focusKey.set(toDateInput(anchor));
    this.view.set(this.mode() === 'month' ? 'months' : 'days');
    const phone = window.matchMedia('(max-width: 600px)').matches;
    this.sheet.set(phone);
    const el = this.trigger().nativeElement;
    this.ref = this.overlay.create({
      hasBackdrop: true,
      backdropClass: phone ? 'ss-sheet-backdrop' : 'cdk-overlay-transparent-backdrop',
      panelClass: phone ? ['ss-date-overlay', 'ss-sheet-pane'] : 'ss-date-overlay',
      scrollStrategy: phone ? this.overlay.scrollStrategies.block() : this.overlay.scrollStrategies.reposition(),
      width: phone ? '100%' : 300,
      positionStrategy: phone
        ? this.overlay.position().global().bottom('0').centerHorizontally()
        : this.overlay
            .position()
            .flexibleConnectedTo(el)
            .withPush(true)
            .withViewportMargin(8)
            .withPositions([
              { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
              { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
            ]),
    });
    this.ref.attach(new TemplatePortal(this.panel(), this.vcr));
    this.ref.backdropClick().subscribe(() => this.close(true));
    this.ref.keydownEvents().subscribe(e => e.key === 'Escape' && this.close(true));
    this.open.set(true);
    setTimeout(() => (this.ref?.overlayElement.querySelector('.cell.focus, .cell.on, .cell.today') as HTMLElement | null)?.focus());
  }

  close(refocus = false): void {
    this.ref?.dispose();
    this.ref = null;
    if (this.open()) this.onTouched();
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
  }

  shift(n: number): void {
    const c = this.cursor();
    this.cursor.set(this.view() === 'months' ? new Date(c.getFullYear() + n, c.getMonth(), 1) : new Date(c.getFullYear(), c.getMonth() + n, 1));
  }

  choose(key: string): void {
    if (!this.allowed(key)) return;
    this.set(key);
  }

  chooseMonth(key: string): void {
    if (this.mode() === 'month') return this.set(key);
    const [y, m] = key.split('-').map(Number);
    this.cursor.set(new Date(y, m - 1, 1));
    this.view.set('days');
  }

  isMonthOn(key: string): boolean {
    return this.mode() === 'month' ? this.value() === key : this.value().startsWith(key);
  }

  clear(e: Event): void {
    e.stopPropagation();
    this.set('');
  }

  onKey(e: KeyboardEvent): void {
    if (this.view() !== 'days') return;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in steps)) return;
    e.preventDefault();
    const cur = fromDateInput(this.focusKey()) ?? new Date();
    const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + steps[e.key]);
    this.focusKey.set(toDateInput(next));
    if (next.getMonth() !== this.cursor().getMonth() || next.getFullYear() !== this.cursor().getFullYear()) {
      this.cursor.set(new Date(next.getFullYear(), next.getMonth(), 1));
    }
    setTimeout(() => (this.ref?.overlayElement.querySelector('.cell.focus') as HTMLElement | null)?.focus());
  }

  private set(v: string): void {
    this.value.set(v);
    this.onChange(v);
    this.dateChange.emit(v);
    this.close(true);
  }

  private allowed(key: string): boolean {
    const min = this.min(), max = this.max();
    return (!min || key >= min) && (!max || key <= max);
  }

  private monthAllowed(key: string): boolean {
    const min = this.min()?.slice(0, 7), max = this.max()?.slice(0, 7);
    return (!min || key >= min) && (!max || key <= max);
  }

  private clampToRange(d: Date): Date {
    const k = toDateInput(d);
    if (this.max() && k > this.max()!) return fromDateInput(this.max()!.length === 7 ? this.max() + '-01' : this.max()) ?? d;
    if (this.min() && k < this.min()!) return fromDateInput(this.min()!.length === 7 ? this.min() + '-01' : this.min()) ?? d;
    return d;
  }
}
