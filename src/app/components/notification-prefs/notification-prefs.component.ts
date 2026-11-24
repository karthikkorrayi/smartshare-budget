import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { FirebaseApp } from '@angular/fire/app';
import { PushService } from '../../services/push.service';
import { SettingsService } from '../../services/settings.service';
import { DEFAULT_SETTINGS, PushKind } from '../../models/settings.model';
import { environment } from '../../../environments/environment';
import { IconComponent } from '../../ui/icon.component';
import { SelectComponent, SelectOption } from '../../ui/select.component';

interface Kind {
  key: PushKind;
  title: string;
  text: string;
  example: string;
  icon: string;
}

const fmtHour = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;

/**
 * Phone notifications: this device on/off, a test push, and which reminders arrive when.
 * Every change saves on its own (settings.patch), so it can sit inside other forms.
 */
@Component({
  selector: 'app-notification-prefs',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, IconComponent, SelectComponent],
  template: `
    <div class="np">
      <div class="device" [attr.data-state]="push.state()">
        <span class="icon-tile" [class.pos]="push.state() === 'on'" [class.warn]="push.state() === 'blocked'"><app-icon [name]="push.state() === 'on' ? 'bell-ring' : 'bell'" [size]="18" /></span>
        <div class="grow">
          <b>This device</b>
          <small>
            @switch (push.state()) {
              @case ('on') { On — reminders arrive even when the app is closed. }
              @case ('blocked') { Blocked. Allow notifications for this site in the browser's site settings, then come back. }
              @case ('unsupported') { This browser can't receive push. On iPhone, add the app to your Home Screen first. }
              @case ('not-configured') { Push isn't configured for this build. }
              @default { Off — turn it on to get reminders on this phone. }
            }
          </small>
        </div>
        @if (push.state() === 'on' || push.state() === 'off') {
          <button type="button" class="btn btn-sm" [class.btn-primary]="push.state() === 'off'" (click)="toggleDevice()" [disabled]="busy()">
            {{ busy() === 'device' ? 'Working…' : push.state() === 'on' ? 'Turn off' : 'Turn on' }}
          </button>
        }
      </div>
      @if (push.state() === 'on') {
        <div class="test">
          <button type="button" class="btn btn-sm btn-soft" (click)="sendTest()" [disabled]="busy()"><app-icon name="send" [size]="14" />{{ busy() === 'test' ? 'Sending…' : 'Send a test notification' }}</button>
          @if (testMsg()) { <small [class.err]="testErr()">{{ testMsg() }}</small> }
        </div>
      }

      <div class="group">
        <div class="ghead">
          <span><app-icon name="sunrise" [size]="15" /><b>Morning</b></span>
          <app-select ariaLabel="Morning notification time" icon="clock" [ngModel]="s().morningHour" (ngModelChange)="setHour('morningHour', $event)" [options]="morningOptions" />
        </div>
        @for (k of morning; track k.key) { <ng-container *ngTemplateOutlet="row; context: { $implicit: k }" /> }
      </div>
      <div class="group">
        <div class="ghead">
          <span><app-icon name="moon" [size]="15" /><b>Evening</b></span>
          <app-select ariaLabel="Evening notification time" icon="clock" [ngModel]="s().eveningHour" (ngModelChange)="setHour('eveningHour', $event)" [options]="eveningOptions" />
        </div>
        @for (k of evening; track k.key) { <ng-container *ngTemplateOutlet="row; context: { $implicit: k }" /> }
      </div>
      <div class="group">
        <div class="ghead"><span><app-icon name="zap" [size]="15" /><b>As it happens</b></span></div>
        @for (k of instant; track k.key) { <ng-container *ngTemplateOutlet="row; context: { $implicit: k }" /> }
      </div>
      @if (saved()) { <small class="saved" aria-live="polite"><app-icon name="check" [size]="13" />{{ saved() }}</small> }
      @if (push.state() !== 'on') { <p class="hint"><app-icon name="info" [size]="13" />These choices are kept for your account; they arrive on devices where notifications are turned on.</p> }
    </div>

    <ng-template #row let-k>
      <label class="kind" [class.on]="isOn(k.key)">
        <span class="icon-tile sm" [class.accent]="isOn(k.key)"><app-icon [name]="k.icon" [size]="15" /></span>
        <span class="grow"><b>{{ k.title }}</b><small>{{ k.text }}</small><i>“{{ k.example }}”</i></span>
        <input type="checkbox" role="switch" [checked]="isOn(k.key)" (change)="setKind(k.key, $any($event.target).checked)" [attr.aria-label]="k.title" />
      </label>
    </ng-template>
  `,
  styles: [`
    .np { display: flex; flex-direction: column; gap: 12px; }
    .device { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface);
      &[data-state='on'] { border-color: color-mix(in srgb, var(--pos) 45%, transparent); background: var(--pos-soft); } }
    .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; b { font-size: 13.5px; } small { font-size: 12px; color: var(--text-3); line-height: 1.4; } }
    .test { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; small { font-size: 12.5px; color: var(--pos); } small.err { color: var(--neg); } }
    .group { display: flex; flex-direction: column; gap: 6px; }
    .ghead { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px;
      > span { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 13px; }
      app-select { width: 150px; } }
    .kind { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer;
      &.on { border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
      i { font-size: 12px; color: var(--text-4); font-style: normal; margin-top: 2px; }
      input { width: 38px; height: 22px; margin-top: 4px; accent-color: var(--accent); cursor: pointer; flex-shrink: 0; } }
    .saved { display: inline-flex; align-items: center; gap: 4px; color: var(--pos); font-size: 12.5px; }
    .hint { display: flex; gap: 6px; align-items: flex-start; margin: 0; font-size: 12.5px; color: var(--text-3); app-icon { margin-top: 2px; } }
  `],
})
export class NotificationPrefsComponent implements OnInit {
  push = inject(PushService);
  private settings = inject(SettingsService);
  private app = inject(FirebaseApp);

  readonly s = toSignal(this.settings.settings$, { initialValue: DEFAULT_SETTINGS });
  busy = signal<'' | 'device' | 'test'>('');
  testMsg = signal('');
  testErr = signal(false);
  saved = signal('');
  private savedTimer: any;

  readonly morningOptions: SelectOption[] = [6, 7, 8, 9, 10, 11].map(h => ({ value: h, label: fmtHour(h) }));
  readonly eveningOptions: SelectOption[] = [17, 18, 19, 20, 21, 22, 23].map(h => ({ value: h, label: fmtHour(h) }));

  readonly morning: Kind[] = [
    { key: 'dues', icon: 'calendar-clock', title: 'Bills & card dues', text: 'Card payments and bills due soon or overdue, statements tomorrow.', example: '2 payments due soon · Rent ₹18,000 due tomorrow' },
    { key: 'streaks', icon: 'trophy', title: 'Streak milestones', text: 'When yesterday took a streak to 3, 7, 14, 30… days. Never for a broken streak.', example: '🏆 7 no-spend days in a row' },
  ];
  readonly evening: Kind[] = [
    { key: 'checkin', icon: 'flame', title: 'Daily check-in', text: 'Only if nothing is logged today — and only while you’ve used the app that week.', example: 'Keep your 12-day streak 🔥 Nothing logged today yet.' },
    { key: 'weekly', icon: 'chart-column', title: 'Sunday recap', text: 'Your week: spent vs last week, no-spend days, limit days. Replaces Sunday’s check-in.', example: 'Your week: ₹6,240 spent (18% less than last week) · 2 no-spend days' },
  ];
  readonly instant: Kind[] = [
    { key: 'reviews', icon: 'inbox', title: 'New items to review', text: 'When Gmail monitoring finds salary, transactions, statements or bills.', example: '3 new items to review' },
  ];

  async ngOnInit(): Promise<void> {
    await this.push.init().catch(() => undefined);
  }

  isOn(key: PushKind): boolean {
    return this.s().push[key];
  }

  async setKind(key: PushKind, on: boolean): Promise<void> {
    await this.save({ push: { [key]: on } }, on ? 'Turned on' : 'Turned off');
  }
  async setHour(key: 'morningHour' | 'eveningHour', h: number): Promise<void> {
    await this.save({ [key]: Number(h) }, `${key === 'morningHour' ? 'Morning' : 'Evening'} notifications at ${fmtHour(Number(h))}`);
  }
  private async save(change: any, label: string): Promise<void> {
    try {
      await this.settings.patch(change);
      this.flash(`${label} · saved`);
    } catch (e) {
      console.error('[NotificationPrefs] save failed', e);
      this.flash('Could not save — check your connection.');
    }
  }
  private flash(t: string): void {
    this.saved.set(t);
    clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => this.saved.set(''), 3000);
  }

  async toggleDevice(): Promise<void> {
    this.busy.set('device');
    this.testMsg.set('');
    try {
      if (this.push.state() === 'on') await this.push.disable();
      else await this.push.enable();
    } catch (e: any) {
      this.testErr.set(true);
      this.testMsg.set(e?.message ?? 'Could not change notifications on this device.');
    } finally {
      this.busy.set('');
    }
  }

  async sendTest(): Promise<void> {
    this.busy.set('test');
    this.testMsg.set('');
    this.testErr.set(false);
    try {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const fn = httpsCallable<void, { sent: number }>(getFunctions(this.app, environment.functionsRegion), 'sendTestPush', { timeout: 30_000 });
      const { data } = await fn();
      this.testMsg.set(data.sent ? `Sent to ${data.sent} device${data.sent === 1 ? '' : 's'} — it should appear in a few seconds.` : 'No device received it. Turn notifications off and on again on this device.');
      this.testErr.set(!data.sent);
    } catch (e: any) {
      console.error('[NotificationPrefs] test failed', e);
      this.testErr.set(true);
      this.testMsg.set(e?.code === 'functions/not-found' ? 'The test needs the latest Cloud Functions deployed.' : 'Could not send the test. Check your connection and try again.');
    } finally {
      this.busy.set('');
    }
  }
}
