import { Component, HostListener, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    @if (auth.loading()) {
      <main class="app-shell"><div class="app-loading">Loading SmartShare Budget…</div></main>
    } @else {
      @if (auth.user() && auth.pinUnlocked()) {
        <header class="top-nav">
          <div class="brand"><div class="brand-badge">💰</div><div class="brand-text"><span class="app-title">SmartShare Budget</span><span class="app-subtitle">Track smarter, spend better</span></div></div>
          <button class="lock-btn" (click)="lockApp()" aria-label="Lock app"><span>🔒</span><span class="lock-label">Lock</span></button>
        </header>
      }
      <main class="app-shell"><router-outlet></router-outlet></main>
    }
  `,
  styleUrl:'./app.component.scss'
})
export class AppComponent {
  auth = inject(AuthService);
  lockApp(): void { this.auth.setPinUnlocked(false); }
  @HostListener('window:keydown', ['$event']) handleKey(event: KeyboardEvent) { if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); this.lockApp(); } }
  @HostListener('window:beforeunload') onRefresh() { this.auth.setPinUnlocked(false); }
}