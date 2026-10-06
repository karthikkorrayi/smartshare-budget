import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="auth-shell">
      <div class="auth-card hero minimal-auth">
        <button class="primary-btn google" (click)="loginWithGoogle()" [disabled]="busy">
          {{ busy === 'google' ? 'Opening Google…' : 'Continue with Google' }}
        </button>

        <div class="auth-divider"><span>or</span></div>

        <form (ngSubmit)="continueWithEmail()">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" [(ngModel)]="email" placeholder="you@example.com" autocomplete="email" required />
          <button class="primary-btn secondary-auth" type="submit" [disabled]="!!busy">
            {{ busy === 'email' ? 'Checking account…' : 'Continue with Email' }}
          </button>
        </form>

        <p class="auth-error" *ngIf="error">{{ error }}</p>
      </div>
    </section>
  `,
})
export class LoginComponent {
  auth = inject(AuthService);
  busy: 'google' | 'email' | '' = '';
  email = '';
  error = '';

  async loginWithGoogle(): Promise<void> {
    try {
      this.error = '';
      this.busy = 'google';
      await this.auth.signInWithGoogle();
    } catch {
      this.error = 'Google sign in failed. Please try again.';
    } finally {
      this.busy = '';
    }
  }

  async continueWithEmail(): Promise<void> {
    try {
      this.error = '';
      this.busy = 'email';
      await this.auth.continueWithEmail(this.email);
    } catch {
      this.error = 'Email sign in failed. Confirm Email/Password is enabled in Firebase Authentication.';
    } finally {
      this.busy = '';
    }
  }
}