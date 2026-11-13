import { Component, inject } from '@angular/core';
import { UNDO_MS, UndoService } from '../../services/undo.service';
import { IconComponent } from '../../ui/icon.component';

/** Bottom snackbar: "<action> · Undo" with a 5-second countdown bar. */
@Component({
  selector: 'app-undo-bar',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="stack" aria-live="polite">
      @for (e of undo.entries(); track e.id) {
        <div class="bar" [class.error]="!!e.error" role="status">
          <span class="msg">{{ e.message }}</span>
          @if (!e.error) {
            <button class="undo" (click)="undo.undo(e.id)">Undo</button>
            <button class="x" (click)="undo.dismiss(e.id)" aria-label="Dismiss"><app-icon name="x" [size]="15" /></button>
            <span class="timer" [style.animation-duration.ms]="remaining(e.expiresAt)"></span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .stack { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 2100; transform: translateX(-50%);
      display: flex; flex-direction: column; gap: 8px; width: min(94vw, 440px); pointer-events: none; }
    .bar { position: relative; overflow: hidden; display: flex; align-items: center; gap: 8px; padding: 12px 10px 12px 16px;
      border-radius: 14px; background: var(--text); color: var(--on-accent); box-shadow: 0 12px 40px rgba(15,23,42,.28); pointer-events: auto; animation: rise .18s ease-out; }
    .bar.error { background: #991b1b; }
    .msg { flex: 1; font-size: 14px; line-height: 1.35; }
    .undo { min-height: 36px; padding: 6px 14px; border: none; border-radius: 10px; background: #2dd4bf; color: #042f2e; font-weight: 800; font-size: 14px; cursor: pointer; }
    .x { border: none; background: none; color: var(--text-4); font-size: 14px; padding: 6px; cursor: pointer; }
    .timer { position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: #2dd4bf; transform-origin: left; animation-name: shrink; animation-timing-function: linear; animation-fill-mode: forwards; }
    @keyframes shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    @keyframes rise { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
  `],
})
export class UndoBarComponent {
  undo = inject(UndoService);
  remaining(expiresAt: number): number {
    return Math.max(0, Math.min(UNDO_MS, expiresAt - Date.now()));
  }
}
