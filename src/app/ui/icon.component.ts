import { ChangeDetectionStrategy, Component, ElementRef, Renderer2, effect, inject, input } from '@angular/core';
import { ICONS } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * <app-icon name="wallet" [size]="18" /> — renders a Lucide icon as inline SVG.
 * Decorative by default (aria-hidden); pass [label] to make it meaningful to screen readers.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`:host { display: inline-flex; line-height: 0; flex-shrink: 0; } :host ::ng-deep svg { display: block; }`],
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<number>(18);
  readonly stroke = input<number>(1.85);
  readonly label = input<string | null>(null);

  private host = inject(ElementRef<HTMLElement>);
  private r = inject(Renderer2);

  constructor() {
    effect(() => {
      const el = this.host.nativeElement as HTMLElement;
      el.replaceChildren();
      const nodes = ICONS[this.name()] ?? ICONS['circle-alert'];
      const svg = this.r.createElement('svg', SVG_NS) as SVGElement;
      const attrs: Record<string, string> = {
        xmlns: SVG_NS,
        width: String(this.size()),
        height: String(this.size()),
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': String(this.stroke()),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
      };
      for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
      const label = this.label();
      if (label) {
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', label);
      } else {
        svg.setAttribute('aria-hidden', 'true');
      }
      for (const [tag, a] of nodes) {
        const child = this.r.createElement(tag, SVG_NS) as SVGElement;
        for (const [k, v] of Object.entries(a)) child.setAttribute(k, String(v));
        svg.appendChild(child);
      }
      el.appendChild(svg);
    });
  }
}
