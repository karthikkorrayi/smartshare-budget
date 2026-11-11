import { Injectable, signal } from '@angular/core';

export interface AppAlert {
  id: number;
  tone: 'info' | 'warn' | 'error' | 'ok';
  title: string;
  body?: string;
  link?: string;
}

/** In-app toast queue (limit warnings, foreground push messages). */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private seq = 0;
  readonly alerts = signal<AppAlert[]>([]);

  show(a: Omit<AppAlert, 'id'>, ttlMs = 8000): void {
    const id = ++this.seq;
    this.alerts.update(list => [...list.slice(-2), { ...a, id }]);
    if (ttlMs > 0) setTimeout(() => this.dismiss(id), ttlMs);
  }

  dismiss(id: number): void {
    this.alerts.update(list => list.filter(a => a.id !== id));
  }
}
