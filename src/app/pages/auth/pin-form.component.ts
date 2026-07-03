import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pin-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <form class="pin-form" (ngSubmit)="submit()">
      <label>{{ label }}</label>
      <input name="pin" inputmode="numeric" maxlength="4" type="password" [(ngModel)]="pin" placeholder="••••" autocomplete="one-time-code" />
      @if (confirmMode) {
        <label>Confirm PIN</label>
        <input name="confirmPin" inputmode="numeric" maxlength="4" type="password" [(ngModel)]="confirmPin" placeholder="••••" autocomplete="one-time-code" />
      }
      @if (error) { <p class="auth-error">{{ error }}</p> }
      <button class="primary-btn" type="submit" [disabled]="busy">{{ busy ? 'Please wait…' : buttonText }}</button>
    </form>
  `
})
export class PinFormComponent {
  @Input() label = 'Create 4 Digit PIN';
  @Input() buttonText = 'Continue';
  @Input() confirmMode = true;
  @Input() busy = false;
  @Output() pinSubmit = new EventEmitter<string>();
  pin = '';
  confirmPin = '';
  error = '';

  submit(): void {
    this.error = '';
    if (!/^\d{4}$/.test(this.pin)) {
      this.error = 'PIN must be exactly four numeric digits.';
      return;
    }
    if (this.confirmMode && this.pin !== this.confirmPin) {
      this.error = 'PIN entries must match.';
      return;
    }
    this.pinSubmit.emit(this.pin);
  }
}