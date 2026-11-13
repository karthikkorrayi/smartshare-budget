import { Injectable, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA install. Uses the browser's real install flow: Chrome / Edge fire `beforeinstallprompt`
 * when the app meets the install criteria (manifest + service worker + HTTPS). We only show an
 * "Install app" action when that event has actually fired — never a fake button. On Android Chrome
 * the browser menu's "Install app" works too. iOS Safari has no prompt; users use Share → Add to Home Screen.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferred: BeforeInstallPromptEvent | null = null;
  readonly canInstall = signal(false);
  readonly installed = signal(matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
  readonly isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;

  constructor() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.canInstall.set(false);
      this.installed.set(true);
    });
  }

  async install(): Promise<boolean> {
    if (!this.deferred) return false;
    await this.deferred.prompt();
    const choice = await this.deferred.userChoice;
    this.deferred = null;
    this.canInstall.set(false);
    return choice.outcome === 'accepted';
  }
}
