import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { ReviewService } from '../../services/review.service';

@Component({
  selector: 'app-cards-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="cc-page">
      <nav class="cc-chips tabs" aria-label="Cards sections">
        <a class="cc-chip" routerLink="/cards" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">💳 Cards</a>
        <a class="cc-chip" routerLink="/cards/transactions" routerLinkActive="active">🧾 Transactions</a>
        <a class="cc-chip" routerLink="/cards/statements" routerLinkActive="active">📄 Statements</a>
        <a class="cc-chip" routerLink="/cards/review" routerLinkActive="active">
          🔍 Review
          @if (pendingCount()) { <span class="cc-count cc-count--alert">{{ pendingCount() }}</span> }
        </a>
      </nav>
      <router-outlet></router-outlet>
    </div>
  `,
  styles: [`.tabs { margin-bottom: 20px; padding-bottom: 2px; }`],
})
export class CardsShellComponent {
  private review = inject(ReviewService);
  pendingCount = toSignal(this.review.pending$.pipe(map(p => p.length)), { initialValue: 0 });
}
