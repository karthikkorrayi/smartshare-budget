import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService, authMessage } from '../../services/auth.service';
import { GmailService } from '../../services/gmail.service';
import { SettingsService } from '../../services/settings.service';
import { PushService } from '../../services/push.service';
import { DEFAULT_SETTINGS, UserSettings } from '../../models/settings.model';

type Busy = '' | 'name' | 'password' | 'google' | 'unlink-google' | 'unlink-password' | 'reset' | 'verify' | 'settings' | 'push';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  auth = inject(AuthService);
  private gmail = inject(GmailService);
  private settingsService = inject(SettingsService);
  push = inject(PushService);

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
