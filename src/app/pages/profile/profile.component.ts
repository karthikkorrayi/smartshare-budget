import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { AuthService, authMessage } from '../../services/auth.service';
import { GmailService } from '../../services/gmail.service';
import { SettingsService } from '../../services/settings.service';
import { PushService } from '../../services/push.service';
import { DEFAULT_SETTINGS, UserSettings } from '../../models/settings.model';
import { FinanceService } from '../../services/finance.service';
import { FinanceTxn, habits } from '../../utils/analytics.util';
import { addDays } from '../../utils/spending.util';
import { MoneyPipe } from '../../ui/money.pipe';
import { ThemeService } from '../../core/theme.service';
import { InstallService } from '../../core/install.service';
import { IconComponent } from '../../ui/icon.component';

type Busy = '' | 'name' | 'password' | 'google' | 'unlink-google' | 'unlink-password' | 'reset' | 'verify' | 'settings' | 'push';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [IconComponent, MoneyPipe, FormsModule, DatePipe, RouterLink],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  auth = inject(AuthService);
  private gmail = inject(GmailService);
  private settingsService = inject(SettingsService);
  push = inject(PushService);
  theme = inject(ThemeService);
  install = inject(InstallService);
  private finance = inject(FinanceService);
  wealth = toSignal(this.finance.wealth$);
  private recent = toSignal(this.finance.window$(addDays(new Date(), -89), addDays(new Date(), 1)), { initialValue: [] as FinanceTxn[] });
  recurringCount = toSignal(this.finance.recurring$.pipe(map(l => l.length)), { initialValue: 0 });
  activityCount = computed(() => this.recent().filter(t => !t.system).length);
  habit = computed(() => habits(this.recent(), null));
  /** Only achievements the data actually supports. */
  achievements = computed(() => {
    const out: { icon: string; title: string; text: string }[] = [];
    const h = this.habit();
    if (h.loggingStreak >= 7) out.push({ icon: 'flame', title: `${h.loggingStreak}-day streak`, text: 'Logged money activity every day' });
    if ((this.wealth()?.accounts ?? 0) >= 1) out.push({ icon: 'landmark', title: 'Accounts connected', text: 'Balances are tracked per account' });
    if (this.recurringCount() >= 3) out.push({ icon: 'calendar-check', title: 'Bills organised', text: `${this.recurringCount()} recurring payments tracked` });
    if (h.monthsTracked >= 3) out.push({ icon: 'trophy', title: `${h.monthsTracked} months tracked`, text: 'Consistent financial records' });
    return out;
  });

  settings = toSignal(this.settingsService.settings$, { initialValue: DEFAULT_SETTINGS });
  /** Editable copy of the settings form. */
  form: UserSettings = structuredClone(DEFAULT_SETTINGS);
  formLoaded = false;

  account = this.auth.account;
  connections = toSignal(this.gmail.connections$, { initialValue: [] });

  hasPassword = computed(() => this.account()?.providers.includes('password') ?? false);
  hasGoogle = computed(() => this.account()?.providers.includes('google.com') ?? false);
  methodCount = computed(() => this.account()?.providers.length ?? 0);
  initial = computed(() => (this.account()?.displayName || this.account()?.email || '?').charAt(0).toUpperCase());

  busy = signal<Busy>('');
  message = signal<{ kind: 'ok' | 'error'; text: string; section: string } | null>(null);

  // Name
  editingName = signal(false);
  name = '';

  // Password
  showPassword = signal(false);
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  async ngOnInit(): Promise<void> {
    await this.push.init();
    // Load the form once the real settings arrive (not the defaults).
    const sub = this.settingsService.settings$.subscribe(s => {
      if (!this.formLoaded) {
        this.form = structuredClone(s);
        this.formLoaded = true;
      }
    });
    setTimeout(() => sub.unsubscribe(), 10_000);
  }

  async saveSettings(): Promise<void> {
    await this.run('settings', 'budget', async () => {
      await this.settingsService.save(this.form);
      return 'Budget & alert settings saved.';
    });
  }

  async togglePush(): Promise<void> {
    await this.run('push', 'budget', async () => {
      if (this.push.state() === 'on') {
        await this.push.disable();
        return 'Push notifications turned off on this device.';
      }
      await this.push.enable();
      return 'Push notifications are on for this device.';
    });
  }

  startEditName(): void {
    this.name = this.account()?.displayName ?? '';
    this.editingName.set(true);
  }

  async saveName(): Promise<void> {
    await this.run('name', 'profile', async () => {
      await this.auth.updateDisplayName(this.name);
      this.editingName.set(false);
      return 'Name updated.';
    });
  }

  togglePassword(): void {
    this.showPassword.update(v => !v);
    this.currentPassword = this.newPassword = this.confirmPassword = '';
  }

  async savePassword(): Promise<void> {
    if (this.newPassword !== this.confirmPassword) {
      this.message.set({ kind: 'error', text: 'New passwords do not match.', section: 'password' });
      return;
    }
    await this.run('password', 'password', async () => {
      if (this.hasPassword()) {
        await this.auth.changePassword(this.currentPassword, this.newPassword);
        this.showPassword.set(false);
        return 'Password changed.';
      }
      await this.auth.setPassword(this.newPassword);
      this.showPassword.set(false);
      return 'Password added. You can now sign in with your Gmail address and this password too.';
    });
  }

  async sendReset(): Promise<void> {
    await this.run('reset', 'password', async () => {
      await this.auth.resetPassword(this.account()!.email);
      return `Reset link sent to ${this.account()!.email}.`;
    });
  }

  async linkGoogle(): Promise<void> {
    await this.run('google', 'methods', async () => {
      await this.auth.linkGoogle();
      return 'Google sign-in linked to this account.';
    });
  }

  async unlink(provider: 'google.com' | 'password'): Promise<void> {
    await this.run(provider === 'google.com' ? 'unlink-google' : 'unlink-password', 'methods', async () => {
      await this.auth.unlinkProvider(provider);
      return provider === 'google.com' ? 'Google sign-in removed.' : 'Password sign-in removed.';
    });
  }

  private async run(kind: Busy, section: string, fn: () => Promise<string>): Promise<void> {
    this.busy.set(kind);
    this.message.set(null);
    try {
      this.message.set({ kind: 'ok', text: await fn(), section });
    } catch (e) {
      this.message.set({ kind: 'error', text: authMessage(e), section });
    } finally {
      this.busy.set('');
    }
  }
}
