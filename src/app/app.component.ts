import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './services/auth.service';
import { NotificationsService } from './services/notifications.service';
import { ReviewService } from './services/review.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <header class="top-nav">
    <div class="brand">
      <div class="brand-badge">💰</div>
      <div class="brand-text">
        <span class="app-title">SmartShare Budget</span>
        <span class="app-subtitle">Track smarter, spend better</span>
      </div>
    </div>

    @if (auth.account(); as a) {
      @if (a.ready) {
        <nav class="main-nav" aria-label="Main">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Overview</a>
          <a routerLink="/cards" routerLinkActive="active">Cards</a>
          <a routerLink="/review" routerLinkActive="active">
            Review @if (pending()) { <span class="nav-count">{{ pending() }}</span> }
          </a>
          <a routerLink="/gmail" routerLinkActive="active">Gmail</a>
        </nav>

        <div class="nav-actions">
          <a class="nav-btn bell" routerLink="/notifications" routerLinkActive="active"
             [attr.aria-label]="'Notifications' + (badge() ? ', ' + badge() + ' new' : '')">
            <span>🔔</span>
            @if (badge()) { <span class="bell-count">{{ badge() > 99 ? '99+' : badge() }}</span> }
          </a>
          <a class="profile-chip" routerLink="/profile" routerLinkActive="active" [title]="a.email" aria-label="Profile and account">
            <span class="avatar">{{ (a.displayName || a.email).charAt(0).toUpperCase() }}</span>
            <span class="profile-name">{{ a.displayName || a.email }}</span>
          </a>
        </div>
      } @else {
        <div class="nav-actions">
          <button class="nav-btn" (click)="auth.logout()">Sign out</button>
        </div>
      }
    }
  </header>

  <main class="app-shell">
    <router-outlet></router-outlet>
  </main>
  `,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  auth = inject(AuthService);
  private notifications = inject(NotificationsService);
  private review = inject(ReviewService);
  badge = toSignal(this.notifications.badgeCount$, { initialValue: 0 });
  pending = toSignal(this.review.pending$.pipe(map(p => p.length)), { initialValue: 0 });
}
