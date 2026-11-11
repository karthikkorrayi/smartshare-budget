import { Injectable, inject, signal } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { Firestore, deleteDoc, doc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { AlertsService } from './alerts.service';
import { environment } from '../../environments/environment';

const DEVICE_KEY = 'ssb_push_device';

export type PushState = 'unsupported' | 'not-configured' | 'blocked' | 'off' | 'on';

/**
 * Web push via Firebase Cloud Messaging.
 * Works in Chrome on Android (even when the tab is closed) and desktop browsers. On iPhone,
 * web push only works after "Add to Home Screen".
 * firebase/messaging is loaded on demand so it doesn't grow the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private app = inject(FirebaseApp);
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private alerts = inject(AlertsService);
  private router = inject(Router);

  readonly state = signal<PushState>('off');
  private listening = false;

  /** Call once the user is signed in: restores state and listens for foreground messages. */
  async init(): Promise<void> {
    const st = await this.detect();
    this.state.set(st);
    if (st === 'on') {
      // Tokens rotate; refresh it quietly and bump lastSeenAt.
      this.register().catch(e => console.warn('[Push] refresh failed', e));
    }
  }

  async enable(): Promise<void> {
    const st = await this.detect();
    if (st === 'unsupported') throw new Error('This browser does not support push notifications.');
    if (st === 'not-configured') throw new Error('Push is not configured (environment.fcmVapidKey is empty).');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      this.state.set(perm === 'denied' ? 'blocked' : 'off');
      throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser\'s site settings.' : 'Permission was not granted.');
    }
    await this.register();
    this.state.set('on');
  }

  async disable(): Promise<void> {
    const id = this.deviceId();
    try {
      const { getMessaging, deleteToken } = await import('firebase/messaging');
      await deleteToken(getMessaging(this.app));
    } catch (e) {
      console.warn('[Push] deleteToken failed', e);
    }
    if (id) await deleteDoc(doc(this.firestore, 'fcm_tokens', id)).catch(() => undefined);
    try { localStorage.removeItem(DEVICE_KEY); } catch { /* storage unavailable */ }
    this.state.set(Notification.permission === 'denied' ? 'blocked' : 'off');
  }

  private async detect(): Promise<PushState> {
    if (!environment.fcmVapidKey) return 'not-configured';
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
    const { isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return Notification.permission === 'granted' && this.deviceId() ? 'on' : 'off';
  }

  private async register(): Promise<void> {
    const { getMessaging, getToken, onMessage } = await import('firebase/messaging');
    // Relative URL → works both on localhost and under the GitHub Pages /smartshare-budget/ path.
    const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js', { scope: './' });
    const messaging = getMessaging(this.app);
    const token = await getToken(messaging, { vapidKey: environment.fcmVapidKey, serviceWorkerRegistration: reg });
    if (!token) throw new Error('Could not get a push token.');

    const id = await sha256(token);
    await setDoc(
      doc(this.firestore, 'fcm_tokens', id),
      {
        userId: this.auth.requireUid(),
        token,
        appUrl: `${location.origin}${location.pathname}`,
        userAgent: navigator.userAgent.slice(0, 160),
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
    const old = this.deviceId();
    if (old && old !== id) await deleteDoc(doc(this.firestore, 'fcm_tokens', old)).catch(() => undefined);
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* storage unavailable */ }

    if (!this.listening) {
      this.listening = true;
      // App is open: show the push as an in-app toast instead of a system notification.
      onMessage(messaging, p => {
        const route = (p.data?.['route'] as string) || '/notifications';
        this.alerts.show({ tone: 'info', title: p.notification?.title ?? 'SmartShare', body: p.notification?.body, link: route }, 10000);
      });
    }
  }

  private deviceId(): string | null {
    try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
  }

  open(link: string): void {
    this.router.navigateByUrl(link);
  }
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
