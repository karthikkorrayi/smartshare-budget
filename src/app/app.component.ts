import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PinLockService } from './services/pin-lock.service';
import { PinLockComponent } from './security/pin-lock/pin-lock.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, PinLockComponent],
  template: `
  <header class="top-nav">
    <div class="brand">
      <div class="brand-badge">💰</div>
      <div class="brand-text">
        <span class="app-title">SmartShare Budget</span>
        <span class="app-subtitle">Track smarter, spend better</span>
      </div>
    </div>

    <button class="lock-btn" (click)="lockApp()" aria-label="Lock app">
      <span>🔒</span>
      <span class="lock-label">Lock</span>
    </button>
  </header>
  <!-- <router-outlet></router-outlet> -->
  <main class="app-shell">
    <app-pin-lock></app-pin-lock>
    @if (!pinService.isLocked) {
      <router-outlet></router-outlet>
    }
  </main>
  `,
  styleUrl:'./app.component.scss'
})
export class AppComponent {

  constructor(public pinService: PinLockService) {}

  lockApp(): void {
    this.pinService.lock();
  }

  // CTRL + L - Lock app
  @HostListener('window:keydown', ['$event'])
  handleKey(event: KeyboardEvent) {
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      this.pinService.lock();
    }
  }

  // Page refresh - lock
  @HostListener('window:beforeunload')
  onRefresh() {
    this.pinService.refreshLock();
  }

  // right-click menu - lock
  @HostListener('document:contextmenu', ['$event'])
  onRightClick(event: MouseEvent) {
    event.preventDefault();
    if (confirm('Lock application?')) {
      this.pinService.lock();
    }
  }

}
