import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';
import { NotificationsService } from './services/notifications.service';

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

    @if (auth.user(); as user) {
      <nav class="main-nav" aria-label="Main">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Overview</a>
        <a routerLink="/cards" routerLinkActive="active">Cards</a>
      </nav>

      <div class="nav-actions">
        <a class="nav-btn bell" routerLink="/notifications" routerLinkActive="active"
           [attr.aria-label]="'Notifications' + (badge() ? ', ' + badge() + ' new' : '')">
          <span>🔔</span>
          @if (badge()) { <span class="bell-count">{{ badge() > 99 ? '99+' : badge() }}</span> }
        </a>
        <span class="user-chip" [title]="user.email ?? ''">
          {{ user.displayName || user.email }}
        </span>
        <button class="nav-btn" (click)="signOut()" aria-label="Sign out">
          <span>⎋</span>
          <span class="nav-label">Sign out</span>
        </button>
      </div>
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
  badge = toSignal(this.notifications.badgeCount$, { initialValue: 0 });

  signOut(): Promise<void> {
    return this.auth.logout();
  }
}
