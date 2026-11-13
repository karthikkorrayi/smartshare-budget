import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { ReviewService } from '../../services/review.service';
import { IconComponent } from '../../ui/icon.component';

/**
 * Review = the financial activity workspace. Two tabs:
 *   Activity     — every transaction, expense, income, transfer, lending record and category.
 *   Email inbox  — the existing Review Center (approve / edit / reject what Gmail sync found).
 */
@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <div class="tabs" role="tablist" aria-label="Review sections">
      <a role="tab" routerLink="/review" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: true }" #a="routerLinkActive" [attr.aria-selected]="a.isActive">
        <app-icon name="list-checks" [size]="16" />Activity
      </a>
      <a role="tab" routerLink="/review/inbox" routerLinkActive="on" #b="routerLinkActive" [attr.aria-selected]="b.isActive">
        <app-icon name="inbox" [size]="16" />Email inbox
        @if (pending()) { <span class="count-pill">{{ pending() }}</span> }
      </a>
    </div>
    <router-outlet />
  `,
  styles: [`
    .tabs { display: flex; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--border); }
    .tabs a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: -1px; border-bottom: 2px solid transparent;
      color: var(--text-3); font-weight: 600; font-size: 13.5px; text-decoration: none; }
    .tabs a:hover { color: var(--text); }
    .tabs a.on { color: var(--accent-strong); border-bottom-color: var(--accent); }
  `],
})
export class ReviewShellComponent {
  pending = toSignal(inject(ReviewService).pending$.pipe(map(p => p.length)), { initialValue: 0 });
}
