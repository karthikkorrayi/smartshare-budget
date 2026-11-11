import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

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
      </nav>
      <router-outlet></router-outlet>
    </div>
  `,
  styles: [`.tabs { margin-bottom: 20px; padding-bottom: 2px; }`],
})
export class CardsShellComponent {}
