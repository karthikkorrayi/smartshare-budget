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
    <div class="nav-left">
      <span class="app-title">Personal Budget Insights</span>
    </div>
  </header>
  <!-- <router-outlet></router-outlet> -->
  <app-pin-lock></app-pin-lock>
    @if (!pinService.isLocked) {
      <router-outlet></router-outlet>
    } 
  `,
  styleUrl:'./app.component.scss'
})
export class AppComponent {

  constructor(public pinService: PinLockService) {}

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
