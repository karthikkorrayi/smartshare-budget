import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, authMessage } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  template: `
    <section class="auth-screen">
      <div class="auth-card">
        <div class="emblem" aria-hidden="true">📧</div>
        <h1>Verify your Gmail</h1>
        <p class="hint">
          We sent a verification link to <strong>{{ auth.account()?.email }}</strong>.
          Open it on any device, then come back here.
        </p>
        <p class="why">
          Verification proves you own this Gmail. It also lets "Continue with Google" open this same
          account instead of creating a new one.
        </p>

        @if (error()) { <p class="msg error" role="alert">{{ error() }}</p> }
        @if (info()) { <p class="msg info" role="status">{{ info() }}</p> }

        <button class="btn primary" (click)="check()" [disabled]="busy()">
          {{ busy() === 'check' ? 'Checking…' : "I've verified — continue" }}
        </button>
        <button class="btn" (click)="resend()" [disabled]="!!busy() || cooldown() > 0">
          {{ cooldown() > 0 ? 'Resend in ' + cooldown() + 's' : busy() === 'resend' ? 'Sending…' : 'Resend link' }}
        </button>
        <button class="link" (click)="auth.logout()">Use a different account</button>
      </div>
    </section>
  `,
  styleUrl: '../login/login.component.scss',
  styles: [
    `.emblem { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 18px; background: #f0fdfa; font-size: 26px; }
     h1 { text-align: center; }
     .hint, .why { text-align: center; color: #475569; line-height: 1.6; font-size: 14px; }
     .why { margin: 0 0 18px; padding: 10px 12px; border-radius: 12px; background: #f8fafc; font-size: 13px; }
     .btn { margin-top: 10px; border: 1px solid #dbe3eb; background: #fff; }
     .btn.primary { border: none; background: #0f766e; color: #fff; }
     .link { display: block; margin: 16px auto 0; }`,
  ],
})
export class VerifyEmailComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  private router = inject(Router);

  busy = signal<'' | 'check' | 'resend'>('');
  error = signal('');
  info = signal('');
  cooldown = signal(0);
  private timer?: ReturnType<typeof setInterval>;
  private poll?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    // Quietly re-check every 5 s so the page continues by itself once the link is clicked.
    this.poll = setInterval(() => this.check(true), 5000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    clearInterval(this.poll);
  }

  async check(silent = false): Promise<void> {
    if (this.busy()) return;
    if (!silent) {
      this.busy.set('check');
      this.error.set('');
    }
    try {
      if (await this.auth.checkVerified()) {
        clearInterval(this.poll);
        await this.router.navigateByUrl('/');
      } else if (!silent) {
        this.error.set('Not verified yet. Open the link in the email (check Spam/Promotions), then try again.');
      }
    } catch (e) {
      if (!silent) this.error.set(authMessage(e));
    } finally {
      if (!silent) this.busy.set('');
    }
  }

  async resend(): Promise<void> {
    this.busy.set('resend');
    this.error.set('');
    try {
      await this.auth.sendVerification();
      this.info.set('A new link is on its way.');
      this.cooldown.set(60);
      this.timer = setInterval(() => {
        this.cooldown.update(v => v - 1);
        if (this.cooldown() <= 0) clearInterval(this.timer);
      }, 1000);
    } catch (e) {
      this.error.set(authMessage(e));
    } finally {
      this.busy.set('');
    }
  }
}
