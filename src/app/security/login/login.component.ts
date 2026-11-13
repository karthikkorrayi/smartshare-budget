import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, authMessage, isGmail } from '../../services/auth.service';
import { LogoComponent } from '../../layout/logo.component';

type Mode = 'signin' | 'signup' | 'reset';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [LogoComponent, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  mode = signal<Mode>('signin');
  busy = signal<'' | 'google' | 'email'>('');
  error = signal('');
  info = signal('');
  /** Set after a rejected email+password sign-in, to offer the two ways back in. */
  credentialHelp = signal(false);

  constructor() {
    // A Google redirect sign-in that failed after the page reloaded.
    effect(() => {
      const err = this.authService.redirectError();
      if (err) this.showError(err, 'google');
    });
  }

  displayName = '';
  email = '';
  password = '';
  confirmPassword = '';

  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set('');
    this.info.set('');
    this.credentialHelp.set(false);
    this.password = '';
    this.confirmPassword = '';
  }

  async google(): Promise<void> {
    await this.run('google', () => this.authService.signInWithGoogle());
  }

  async submit(): Promise<void> {
    const mode = this.mode();
    if (!isGmail(this.email)) {
      this.error.set('Use your @gmail.com address. Other email providers are not supported.');
      return;
    }

    if (mode === 'reset') {
      await this.run('email', async () => {
        await this.authService.resetPassword(this.email);
        // Same message whether or not the account exists (no account enumeration).
        this.info.set('If an account exists for that email, a reset link is on its way.');
      }, false);
      return;
    }

    if (mode === 'signup') {
      if (this.password.length < 8) return this.error.set('Use at least 8 characters for your password.');
      if (this.password !== this.confirmPassword) return this.error.set('Passwords do not match.');
      await this.run('email', () => this.authService.signUpWithEmail(this.displayName, this.email, this.password));
      return;
    }

    await this.run('email', () => this.authService.signInWithEmail(this.email, this.password));
  }

  /** One-tap reset for the Gmail that was just rejected. */
  async sendResetFor(): Promise<void> {
    await this.run('email', async () => {
      await this.authService.resetPassword(this.email);
      this.credentialHelp.set(false);
      this.info.set(`If ${this.email.trim().toLowerCase()} has an account, a reset link is on its way (check Spam too). If you only ever used Google, use "Continue with Google" instead.`);
    }, false);
  }

  private async run(kind: 'google' | 'email', action: () => Promise<void>, navigate = true): Promise<void> {
    this.error.set('');
    this.info.set('');
    this.credentialHelp.set(false);
    this.busy.set(kind);
    try {
      await action();
      if (navigate) {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('/login')) {
          await this.router.navigateByUrl(returnUrl);
        }
      }
    } catch (err: any) {
      this.showError(err, kind);
    } finally {
      this.busy.set('');
    }
  }

  private showError(err: any, kind: 'google' | 'email'): void {
    if (kind === 'google' && (err?.code === 'auth/invalid-credential' || err?.code === 'auth/invalid-idp-response')) {
      // Google accepted you, but Firebase couldn't finish with Google: almost always the Google
      // provider's client ID/secret in Firebase Authentication no longer matches Google Cloud.
      console.warn('[Login] Google sign-in rejected by Firebase', err?.code, err?.message ?? '');
      this.error.set(
        `Google sign-in isn't working right now (${err.code}). Sign in with your Gmail and password instead — it opens the same account.`
      );
      return;
    }
    if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password' || err?.code === 'auth/user-not-found') {
      // Firebase deliberately doesn't say which part is wrong (email-enumeration protection),
      // so offer both recovery paths instead of a dead end.
      this.error.set("We couldn't sign you in with that Gmail and password.");
      this.credentialHelp.set(this.mode() === 'signin');
      return;
    }
    if (err?.code === 'link-google') {
      // Google needs one password sign-in to link: prefill the Gmail and switch to the form.
      this.mode.set('signin');
      this.email = this.authService.pendingGoogleEmail() ?? this.email;
      this.info.set(authMessage(err));
      return;
    }
    console.warn('[Login] sign-in failed', err?.code ?? err);
    this.error.set(authMessage(err));
  }
}
