import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertsService, AppAlert } from '../../services/alerts.service';
import { IconComponent } from '../../ui/icon.component';

/** Bottom toasts for limit warnings and foreground push messages. */
@Component({
  selector: 'app-alert-host',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="host" aria-live="polite">
      @for (a of alerts.alerts(); track a.id) {
        <div class="toast" [class]="'t-' + a.tone" role="status">
          <button class="body" (click)="open(a)">
            <strong>{{ a.title }}</strong>
            @if (a.body) { <span>{{ a.body }}</span> }
          </button>
          <button class="x" (click)="alerts.dismiss(a.id)" aria-label="Dismiss"><app-icon name="x" [size]="15" /></button>
        </div>
      }
    </div>
  `,
  styles: [`
    .host { position: fixed; left: 50%; top: 92px; z-index: 2000; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; width: min(94vw, 460px); pointer-events: none; }
    .toast { display: flex; align-items: flex-start; gap: 8px; padding: 12px 12px 12px 16px; border-radius: 16px; background: var(--text); color: var(--on-accent);
      box-shadow: 0 12px 40px rgba(15,23,42,.25); pointer-events: auto; animation: rise .2s ease-out; }
    .t-warn { background: #92400e; } .t-error { background: #991b1b; } .t-ok { background: var(--accent-strong); }
    .body { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 0; border: none; background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; }
    strong { font-size: 14px; } span { font-size: 13px; opacity: .9; line-height: 1.4; }
    .x { border: none; background: none; color: inherit; opacity: .7; cursor: pointer; font-size: 14px; padding: 2px 6px; }
    @keyframes rise { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
  `],
})
export class AlertHostComponent {
  alerts = inject(AlertsService);
  private router = inject(Router);

  open(a: AppAlert): void {
    this.alerts.dismiss(a.id);
    if (a.link) this.router.navigateByUrl(a.link);
  }
}
