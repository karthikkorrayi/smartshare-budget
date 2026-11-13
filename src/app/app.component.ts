import { Component, effect, inject, isDevMode } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';
import { PushService } from './services/push.service';
import { ThemeService } from './core/theme.service';
import { InstallService } from './core/install.service';
import { AlertHostComponent } from './components/alert-host/alert-host.component';
import { UndoBarComponent } from './components/undo-bar/undo-bar.component';

/**
 * Root: routes (the signed-in shell is a layout route — see app.routes.ts), global toasts and the
 * Undo bar. Removes the branded splash screen from index.html once auth state is known.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AlertHostComponent, UndoBarComponent],
  template: `
    <router-outlet />
    <app-alert-host />
    <app-undo-bar />
  `,
  styles: [`:host { display: block; min-height: 100dvh; }`],
})
export class AppComponent {
  auth = inject(AuthService);
  private push = inject(PushService);
  private pushStartedFor: string | null = null;
  // Instantiated at startup: applies the theme and starts listening for the install prompt.
  private theme = inject(ThemeService);
  private install = inject(InstallService);

  constructor() {
    // Restore push on this device once a verified user is signed in (loads firebase/messaging lazily).
    effect(() => {
      const a = this.auth.account();
      if (a?.ready && this.pushStartedFor !== a.uid) {
        this.pushStartedFor = a.uid;
        this.push.init().catch(e => console.warn('[Push] init failed', e));
      }
      if (!a) this.pushStartedFor = null;
    });

    // PWA: install + offline fallback. Same worker (and scope) the push service uses, so both share it.
    if (!isDevMode() && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('firebase-messaging-sw.js', { scope: './' }).catch(e => console.warn('[PWA] service worker', e));
      });
    }

    this.auth.ready().finally(() => {
      const splash = document.getElementById('ssb-splash');
      if (!splash) return;
      splash.classList.add('done');
      setTimeout(() => splash.remove(), 450);
    });
  }
}
