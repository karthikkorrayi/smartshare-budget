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

export interface SelectOption<T = any> {
  value: T;
  label: string;
  /** Lucide icon name. */
  icon?: string;
  /** Second line, e.g. a balance or a hint. */
  hint?: string;
  disabled?: boolean;
  /** Optional group heading the option sits under. */
  group?: string;
}

let nextId = 0;

/**
 * Themed replacement for <select>. Works with [(ngModel)] / formControl, or [value] + (valueChange).
 *   <app-select [options]="opts" [(ngModel)]="x" placeholder="Choose…" />
 * Opens as an anchored panel on wide screens and as a bottom sheet on phones. Keyboard: ↑ ↓ Home End,
 * Enter/Space to pick, Esc to close, type to jump. A search box appears for long lists.
 */
@Component({
  selector: 'app-select',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true }],
  template: `
    <button #trigger type="button" class="sel" [class.open]="open()" [class.compact]="compact()" [class.invalid]="invalid()"
            [disabled]="isDisabled()" (click)="toggle()" (keydown)="onTriggerKey($event)"
            role="combobox" aria-haspopup="listbox" [attr.aria-expanded]="open()" [attr.aria-controls]="listId"
            [attr.aria-label]="ariaLabel() || null" [attr.id]="inputId() || null">
      @if (selected(); as s) {
        @if (s.icon) { <app-icon class="lead" [name]="s.icon" [size]="16" /> }
        <span class="val">{{ s.label }}</span>
      } @else {
        @if (icon()) { <app-icon class="lead" [name]="icon()!" [size]="16" /> }
        <span class="val ph">{{ placeholder() }}</span>
      }
      <app-icon class="chev" name="chevron-down" [size]="16" />
    </button>

    <ng-template #panel>
      <div class="sel-panel" [class.sheet]="sheet()" role="presentation" (keydown)="onPanelKey($event)">
        @if (sheet()) {
          <div class="sheet-head"><span>{{ ariaLabel() || placeholder() }}</span>
            <button type="button" class="x" aria-label="Close" (click)="close(true)"><app-icon name="x" [size]="18" /></button></div>
        }
        @if (searchable()) {
          <div class="search"><app-icon name="search" [size]="15" />
            <input #search type="text" [value]="query()" (input)="query.set($any($event.target).value); active.set(0)"
                   placeholder="Search…" aria-label="Search options" autocomplete="off" />
          </div>
        }
        <ul class="opts" role="listbox" [id]="listId" [attr.aria-label]="ariaLabel() || placeholder()">
          @for (o of filtered(); track $index; let i = $index) {
            @if (o.group && (i === 0 || filtered()[i - 1].group !== o.group)) { <li class="grp" role="presentation">{{ o.group }}</li> }
            <li role="option" class="opt" [id]="listId + '-' + i" [class.active]="i === active()" [class.sel-on]="isSelected(o)"
                [class.dis]="o.disabled" [attr.aria-selected]="isSelected(o)" [attr.aria-disabled]="o.disabled || null"
                (mouseenter)="active.set(i)" (click)="pick(o)">
              @if (o.icon) { <span class="oi"><app-icon [name]="o.icon" [size]="16" /></span> }
              <span class="ot"><span class="ol">{{ o.label }}</span>@if (o.hint) { <span class="oh">{{ o.hint }}</span> }</span>
              @if (isSelected(o)) { <app-icon class="tick" name="check" [size]="16" /> }
            </li>
          } @empty {
            <li class="none" role="presentation">No matches</li>
          }
        </ul>
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
    .chev { color: var(--text-3); transition: transform .15s; }
    .sel.open .chev { transform: rotate(180deg); }
  `],
})
export class SelectComponent<T = any> implements ControlValueAccessor {
  private overlay = inject(Overlay);
  private vcr = inject(ViewContainerRef);
  private host = inject(ElementRef<HTMLElement>);

  readonly options = input<SelectOption<T>[]>([]);
  readonly placeholder = input('Select…');
  readonly ariaLabel = input<string>('');
  readonly icon = input<string | null>(null);
  readonly compact = input(false);
  readonly invalid = input(false);
  readonly inputId = input<string>('');
  /** Search box: 'auto' shows it for more than 8 options. */
  readonly search = input<boolean | 'auto'>('auto');
  /** Non-forms usage: [value] + (valueChange). */
  readonly value = input<T | undefined>(undefined);
  readonly valueChange = output<T>();

  readonly listId = `ss-sel-${++nextId}`;
  private trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private panel = viewChild.required<TemplateRef<unknown>>('panel');

  readonly open = signal(false);
  readonly active = signal(0);
  readonly query = signal('');
  private model = signal<T | undefined>(undefined);
  private disabledByForm = signal(false);
  readonly sheet = signal(false);
  private ref: OverlayRef | null = null;
  private onChange: (v: T) => void = () => {};
  private onTouched: () => void = () => {};
  private typed = '';
  private typedAt = 0;

  readonly isDisabled = computed(() => this.disabledByForm());
  readonly current = computed(() => (this.hasModelSignal() ? this.model() : this.value()));
  private hasModelSignal = signal(false);
  readonly selected = computed(() => this.options().find(o => this.same(o.value, this.current())) ?? null);
  readonly searchable = computed(() => (this.search() === 'auto' ? this.options().length > 8 : !!this.search()));
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.options().filter(o => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(q)) : this.options();
  });

  // ── ControlValueAccessor ────────────────────────────────────
  writeValue(v: T): void {
    this.hasModelSignal.set(true);
    this.model.set(v);
  }
  registerOnChange(fn: (v: T) => void): void {
    this.onChange = fn;
    this.hasModelSignal.set(true);
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabledByForm.set(d);
  }

  isSelected(o: SelectOption<T>): boolean {
    return this.same(o.value, this.current());
  }

  toggle(): void {
    this.open() ? this.close(true) : this.openPanel();
  }

  openPanel(): void {
    if (this.open() || this.isDisabled()) return;
    const phone = window.matchMedia('(max-width: 600px)').matches;
    this.sheet.set(phone);
    this.query.set('');
    const idx = this.filtered().findIndex(o => this.isSelected(o));
    this.active.set(Math.max(0, idx));
    const anchor = this.trigger().nativeElement;
    this.ref = this.overlay.create({
      hasBackdrop: true,
      backdropClass: phone ? 'ss-sheet-backdrop' : 'cdk-overlay-transparent-backdrop',
      panelClass: phone ? ['ss-select-overlay', 'ss-sheet-pane'] : 'ss-select-overlay',
      scrollStrategy: phone ? this.overlay.scrollStrategies.block() : this.overlay.scrollStrategies.reposition(),
      positionStrategy: phone
        ? this.overlay.position().global().bottom('0').centerHorizontally()
        : this.overlay
            .position()
            .flexibleConnectedTo(anchor)
            .withPush(true)
            .withViewportMargin(8)
            .withPositions([
              { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
              { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
            ]),
      width: phone ? '100%' : undefined,
      minWidth: phone ? undefined : Math.max(anchor.offsetWidth, 200),
      maxWidth: phone ? undefined : Math.max(anchor.offsetWidth, 360),
    });
    this.ref.attach(new TemplatePortal(this.panel(), this.vcr));
    this.ref.backdropClick().subscribe(() => this.close(true));
    this.ref.keydownEvents().subscribe(e => e.key === 'Escape' && this.close(true));
    this.open.set(true);
    setTimeout(() => {
      const el = this.ref?.overlayElement;
      (el?.querySelector('.search input') as HTMLInputElement | null)?.focus();
      if (!this.searchable()) (el?.querySelector('.opts') as HTMLElement | null)?.setAttribute('tabindex', '-1');
      if (!this.searchable()) (el?.querySelector('.opts') as HTMLElement | null)?.focus();
      this.scrollActive();
    });
  }

  close(refocus = false): void {
    this.ref?.dispose();
    this.ref = null;
    if (this.open()) this.onTouched();
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
  }

  pick(o: SelectOption<T>): void {
    if (o.disabled) return;
    this.model.set(o.value);
    this.onChange(o.value);
    this.valueChange.emit(o.value);
    this.close(true);
  }

  onTriggerKey(e: KeyboardEvent): void {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      this.openPanel();
    }
  }

  onPanelKey(e: KeyboardEvent): void {
    const list = this.filtered();
    const move = (to: number) => {
      e.preventDefault();
      if (!list.length) return;
      let i = Math.max(0, Math.min(list.length - 1, to));
      // skip disabled
      const dir = to >= this.active() ? 1 : -1;
      while (list[i]?.disabled && i + dir >= 0 && i + dir < list.length) i += dir;
      this.active.set(i);
      this.scrollActive();
    };
    switch (e.key) {
      case 'ArrowDown': return move(this.active() + 1);
      case 'ArrowUp': return move(this.active() - 1);
      case 'Home': return move(0);
      case 'End': return move(list.length - 1);
      case 'Enter':
        e.preventDefault();
        if (list[this.active()]) this.pick(list[this.active()]);
        return;
      case 'Tab':
        this.close(false);
        return;
      default:
        if (!this.searchable() && e.key.length === 1 && /\S/.test(e.key)) {
          const now = Date.now();
          this.typed = now - this.typedAt > 700 ? e.key.toLowerCase() : this.typed + e.key.toLowerCase();
          this.typedAt = now;
          const i = list.findIndex(o => o.label.toLowerCase().startsWith(this.typed));
          if (i >= 0) move(i);
        } else if (e.key === ' ' && !this.searchable()) {
          e.preventDefault();
          if (list[this.active()]) this.pick(list[this.active()]);
        }
    }
  }

  private scrollActive(): void {
    queueMicrotask(() => this.ref?.overlayElement.querySelector('.opt.active')?.scrollIntoView({ block: 'nearest' }));
  }

  private same(a: unknown, b: unknown): boolean {
    return a === b || (a != null && b != null && String(a) === String(b) && typeof a !== 'object');
  }
}
