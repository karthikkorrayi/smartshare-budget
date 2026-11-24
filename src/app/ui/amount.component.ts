import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IconComponent } from './icon.component';
import { MASK, PrivacyService } from '../core/privacy.service';
import { inr } from '../utils/analytics.util';
import { moneyShort } from './money.pipe';

/**
 * A balance that starts hidden: "₹ ******" plus an eye button that reveals it.
 *   <app-amount [value]="a.balance" [privacyKey]="a.key" />
 * The same privacyKey shows/hides the same figure on every screen. The eye button never triggers
 * the click of a card or row it sits in.
 */
@Component({
  selector: 'app-amount',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="amt num" [class.masked]="!visible()" [class.neg]="visible() && negative()" [attr.aria-live]="'polite'">{{ shown() }}{{ visible() && suffix() ? ' ' + suffix() : '' }}</span>
    <button type="button" class="eye" (click)="toggle($event)" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()"
            [attr.aria-label]="(visible() ? 'Hide ' : 'Show ') + (label() || 'amount')" [attr.aria-pressed]="visible()"
            [title]="visible() ? 'Hide' : 'Show'">
      <app-icon [name]="visible() ? 'eye-off' : 'eye'" [size]="iconSize()" />
    </button>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; vertical-align: middle; }
    .amt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Asterisks sit high and run wide at large sizes: draw the mask a bit smaller and centred. */
    .amt.masked { font-size: max(.78em, 12.5px); letter-spacing: .02em; line-height: 1; position: relative; top: .12em; }
    .amt.neg { color: var(--neg); }
    .eye {
      display: inline-grid; place-items: center; flex-shrink: 0; width: 28px; height: 28px; margin: -4px 0;
      padding: 0; border: 0; border-radius: 8px; background: transparent; color: inherit; opacity: .7; cursor: pointer;
      transition: background .15s, opacity .15s;
    }
    .eye:hover, .eye:focus-visible { opacity: 1; background: color-mix(in srgb, currentColor 12%, transparent); }
    .eye:focus-visible { outline: 2px solid var(--accent-ring); outline-offset: 1px; }
  `],
})
export class AmountComponent {
  private privacy = inject(PrivacyService);

  readonly value = input.required<number | null | undefined>();
  readonly privacyKey = input.required<string>();
  /** Screen-reader name, e.g. "HDFC Savings balance". */
  readonly label = input<string>('');
  readonly decimals = input(false);
  readonly short = input(false);
  readonly suffix = input<string>('');
  /** Show negatives in red. */
  readonly signed = input(false);
  readonly iconSize = input(15);

  readonly visible = computed(() => this.privacy.isVisible(this.privacyKey()));
  readonly negative = computed(() => this.signed() && (Number(this.value()) || 0) < 0);
  readonly shown = computed(() => {
    if (!this.visible()) return MASK;
    const v = Number(this.value()) || 0;
    return this.short() ? moneyShort(v) : inr(v, this.decimals());
  });

  toggle(e: Event): void {
    e.stopPropagation();
    e.preventDefault();
    this.privacy.toggle(this.privacyKey());
  }
}
