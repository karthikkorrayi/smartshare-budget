import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PinLockService } from '../../services/pin-lock.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type AuthStep = 'signin' | 'register' | 'verify';

@Component({
  selector: 'app-pin-lock',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pin-lock.component.html',
  styleUrl: './pin-lock.component.scss',
})
export class PinLockComponent implements OnInit, OnDestroy {
  // PIN Entry
  pin = '';
  error = false;
  errorMessage = '';
  numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  
  // Authentication states
  isNewUser = false;
  registrationStep: AuthStep = 'signin';
  currentUserEmail = '';
  isLoading = false;
  
  // Registration form
  displayName = '';
  registrationPin = '';
  confirmPin = '';
  registrationError = '';
  
  // PIN reset
  showForgotPin = false;
  resetEmail = '';
  resetSent = false;
  forgotPinError = '';
  
  private destroy$ = new Subject<void>();

  constructor(
    public pinService: PinLockService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    console.log('PinLockComponent initialized');
    
    // Subscribe to current user changes
    this.authService.getCurrentUser()
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        console.log('Current user changed:', user?.email);
        
        if (user && this.pinService.isLocked) {
          // User is authenticated but app is locked - show PIN verification
          this.currentUserEmail = user.email || '';
          const userProfile = this.authService.getUserProfileSync();
          
          if (userProfile?.isRegistered) {
            console.log('User is registered, showing PIN verification');
            this.registrationStep = 'verify';
            this.pin = '';
          } else {
            console.log('User is not registered, showing registration form');
            this.registrationStep = 'register';
          }
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (this.registrationStep === 'verify') {
      this.onKey(event);
    }
  }

  // ============ STEP 1: Sign in with Google ============
  async signInWithGoogle() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.error = false;
    this.errorMessage = '';

    try {
      console.log('Starting Google Sign-In...');
      const result = await this.authService.signInWithGoogle();
      
      console.log('Sign-in result:', result);
      
      if (result.isNewUser) {
        // New user - proceed to registration
        console.log('New user detected, showing registration form');
        this.isNewUser = true;
        this.registrationStep = 'register';
        this.currentUserEmail = result.user.email || '';
        this.pin = '';
      } else {
        // Existing user - ask for PIN
        console.log('Existing user, showing PIN verification');
        this.registrationStep = 'verify';
        this.pin = '';
      }
    } catch (error: any) {
      console.error('Sign-in error:', error);
      this.error = true;
      this.errorMessage = error?.message || 'Sign-in failed. Please try again.';
      setTimeout(() => {
        this.error = false;
        this.errorMessage = '';
      }, 3000);
    } finally {
      this.isLoading = false;
    }
  }

  // ============ STEP 2: Complete Registration ============
  async completeRegistration() {
    // Validation
    if (!this.displayName.trim()) {
      this.registrationError = 'Please enter your name';
      return;
    }

    if (this.registrationPin.length !== 4 || !/^\d+$/.test(this.registrationPin)) {
      this.registrationError = 'PIN must be 4 digits';
      return;
    }

    if (this.registrationPin !== this.confirmPin) {
      this.registrationError = 'PINs do not match';
      return;
    }

    this.isLoading = true;
    this.registrationError = '';

    try {
      const user = this.authService.getCurrentUserSync();
      
      if (!user) {
        this.registrationError = 'User session not found. Please sign in again.';
        return;
      }

      console.log('Completing registration for:', user.uid);

      await this.authService.completeRegistration(
        user.uid,
        this.displayName,
        this.registrationPin
      );

      console.log('Registration completed successfully');

      // Reset form and proceed to PIN verification
      this.registrationStep = 'verify';
      this.pin = '';
      this.displayName = '';
      this.registrationPin = '';
      this.confirmPin = '';
      this.isNewUser = false;
    } catch (error: any) {
      console.error('Registration error:', error);
      this.registrationError = error?.message || 'Registration failed. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  // ============ STEP 3: Verify PIN ============
  press(num: number) {
    if (this.pin.length >= 4) return;
    this.pin += num;
    this.checkAutoUnlock();
  }

  remove() {
    this.pin = this.pin.slice(0, -1);
  }

  async checkAutoUnlock() {
    if (this.pin.length === 4) {
      setTimeout(async () => {
        try {
          const user = this.authService.getCurrentUserSync();
          
          if (!user) {
            console.error('No authenticated user found');
            this.error = true;
            this.errorMessage = 'User session lost. Please sign in again.';
            this.pin = '';
            setTimeout(() => this.clearError(), 2000);
            return;
          }

          console.log('Verifying PIN for user:', user.uid);
          const ok = await this.authService.verifyPin(user.uid, this.pin);
          
          if (ok) {
            console.log('PIN verification successful');
            this.pinService.unlock();
          } else {
            console.log('PIN verification failed');
            this.error = true;
            this.errorMessage = 'Invalid PIN';
            this.pin = '';
            setTimeout(() => this.clearError(), 1500);
          }
        } catch (error: any) {
          console.error('PIN verification error:', error);
          this.error = true;
          this.errorMessage = 'Verification failed';
          this.pin = '';
          setTimeout(() => this.clearError(), 2000);
        }
      }, 150);
    }
  }

  private clearError() {
    this.error = false;
    this.errorMessage = '';
  }

  onKey(event: KeyboardEvent) {
    if (event.key >= '0' && event.key <= '9') {
      this.press(Number(event.key));
    }
    if (event.key === 'Backspace') {
      this.remove();
    }
  }

  // ============ Forgot PIN ============
  async requestPinReset() {
    if (!this.resetEmail.trim()) {
      this.forgotPinError = 'Please enter your email';
      return;
    }

    this.isLoading = true;
    this.forgotPinError = '';

    try {
      console.log('Requesting PIN reset for email:', this.resetEmail);
      await this.authService.initiatePasswordReset(this.resetEmail);
      
      this.resetSent = true;
      console.log('Password reset email sent');
      
      setTimeout(() => {
        this.showForgotPin = false;
        this.resetSent = false;
        this.resetEmail = '';
      }, 4000);
    } catch (error: any) {
      console.error('Reset error:', error);
      this.forgotPinError = error?.message || 'Email not found or reset failed';
    } finally {
      this.isLoading = false;
    }
  }

  // ============ Sign out ============
  async signOut() {
    try {
      console.log('Signing out...');
      await this.authService.signOut();
      this.registrationStep = 'signin';
      this.pin = '';
      this.showForgotPin = false;
      this.displayName = '';
      this.registrationPin = '';
      this.confirmPin = '';
      this.currentUserEmail = '';
      console.log('Sign out successful');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }

  // ============ Helper methods ============
  closeForgotPin() {
    this.showForgotPin = false;
    this.resetEmail = '';
    this.forgotPinError = '';
    this.resetSent = false;
  }

  onForgotPinClick() {
    this.showForgotPin = true;
    this.forgotPinError = '';
    this.resetSent = false;
  }
}
