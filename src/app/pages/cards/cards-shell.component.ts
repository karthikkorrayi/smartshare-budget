import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IconComponent } from '../../ui/icon.component';

@Component({
  selector: 'app-cards-shell',
  standalone: true,
  imports: [IconComponent, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="cc-page">
      <nav class="cc-chips tabs" aria-label="Cards and wallets sections">
        <a class="cc-chip" routerLink="/cards" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><app-icon name="credit-card" [size]="15" /> Cards</a>
        <a class="cc-chip" routerLink="/cards/transactions" routerLinkActive="active"><app-icon name="list-checks" [size]="15" /> Transactions</a>
        <a class="cc-chip" routerLink="/cards/statements" routerLinkActive="active"><app-icon name="receipt-text" [size]="15" /> Statements</a>
        <a class="cc-chip" routerLink="/cards/wallets" routerLinkActive="active"><app-icon name="wallet" [size]="15" /> Wallets</a>
      </nav>
      <router-outlet></router-outlet>
    </div>
  `,
  styles: [`.tabs { margin-bottom: 20px; padding-bottom: 2px; }`],
})
export class CardsShellComponent {}
