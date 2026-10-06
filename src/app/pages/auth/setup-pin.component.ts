import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AvatarService } from '../../services/avatar.service';
import { PinFormComponent } from './pin-form.component';

@Component({
  selector: 'app-setup-pin',
  standalone: true,
  imports: [CommonModule, PinFormComponent],
  template: `
    <section class="auth-shell">
      <div class="auth-card setup-card">
        <img class="avatar selected-avatar" [src]="selectedAvatar()" alt="Selected avatar">
        <h1>Create 4 Digit PIN</h1>
        <p class="muted">{{ auth.profile()?.email }}</p>

        <div class="avatar-picker" aria-label="Choose an avatar">
          <button type="button" *ngFor="let avatar of avatarOptions()" [class.selected]="selectedAvatar() === avatar.url" (click)="selectAvatar(avatar.url, avatar.style)">
            <img [src]="avatar.url" [alt]="avatar.label + ' avatar'">
          </button>
        </div>

        <app-pin-form [confirmMode]="false" [busy]="busy" (pinSubmit)="save($event)"></app-pin-form>
        <p class="success" *ngIf="done">Setup Complete</p>
      </div>
    </section>
  `,
})
export class SetupPinComponent {
  auth = inject(AuthService);
  router = inject(Router);
  avatars = inject(AvatarService);
  busy = false;
  done = false;
  selectedStyle = signal('bottts');
  selectedAvatar = signal('');
  avatarOptions = computed(() => this.avatars.options(this.auth.profile()?.email || this.auth.user()?.uid || 'smartshare'));

  constructor() {
    effect(() => {
      const profile = this.auth.profile();
      if (!this.selectedAvatar()) {
        this.selectedAvatar.set(profile?.avatarUrl || this.avatars.defaultAvatar(profile?.uid || 'smartshare'));
        this.selectedStyle.set(profile?.avatarStyle || 'bottts');
      }
    });
  }

  selectAvatar(url: string, style: string): void { this.selectedAvatar.set(url); this.selectedStyle.set(style); }

  async save(pin: string): Promise<void> {
    this.busy = true;
    await this.auth.completePinSetup(pin, this.selectedAvatar(), this.selectedStyle());
    this.done = true;
    await this.router.navigateByUrl('/dashboard');
  }
}