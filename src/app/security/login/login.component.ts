import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

type Mode = 'signin' | 'signup' | 'reset';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
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

  displayName = '';
  email = '';
  password = '';
  confirmPassword = '';

  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set('');
    this.info.set('');
    this.password = '';
    this.confirmPassword = '';
  }

  async google(): Promise<void> {
    await this.run('google', () => this.authService.signInWithGoogle());
  }

  async submit(): Promise<void> {
    const mode = this.mode();

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

  private async run(kind: 'google' | 'email', action: () => Promise<void>, navigate = true): Promise<void> {
    this.error.set('');
    this.info.set('');
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
      this.error.set(this.message(err?.code));
    } finally {
      this.busy.set('');
    }
  }

  private message(code: string | undefined): string {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Email or password is incorrect.';
      case 'auth/email-already-in-use':
        return 'An account already exists for this email. Try signing in instead.';
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/weak-password':
        return 'Password is too weak. Use at least 8 characters.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Wait a minute and try again.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'Google sign-in was cancelled.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorised in Firebase Authentication settings.';
      case 'auth/operation-not-allowed':
        return 'This sign-in method is not enabled in the Firebase console.';
      case 'auth/network-request-failed':
        return 'Network error. Check your connection.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }
}
