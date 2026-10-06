import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Component({
  selector: 'app-pin-form',
  standalone: true,
  imports: [CommonModule],
  template: `
    <form class="pin-form pin-lock-form" (ngSubmit)="submit()" autocomplete="off">
      <label>{{ label }}</label>
      <div class="pin-dots" [class.shake]="error">
        <span *ngFor="let dot of dots; let i = index" [class.filled]="i < pin.length"></span>
      </div>
      @if (confirmMode && pin.length === 4) {
        <p class="muted pin-step">Confirm your PIN</p>
        <div class="pin-dots" [class.shake]="error">
          <span *ngFor="let dot of dots; let i = index" [class.filled]="i < confirmPin.length"></span>
        </div>
      }
      @if (error) { <p class="auth-error">{{ error }}</p> }
      <div class="pin-keypad" aria-label="PIN keypad">
        <button type="button" *ngFor="let key of keys" (click)="press(key)">{{ key }}</button>
        <button type="button" class="clear" (click)="clear()">Clear</button>
        <button type="button" (click)="press(0)">0</button>
        <button type="button" class="backspace" (click)="remove()" aria-label="Backspace">⌫</button>
      </div>
      <button class="primary-btn" type="submit" [disabled]="busy || !ready">{{ busy ? 'Please wait…' : buttonText }}</button>
    </form>
  `,
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
  keys = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  dots = [0, 1, 2, 3];

  get activeValue(): string { return this.confirmMode && this.pin.length === 4 ? this.confirmPin : this.pin; }
  set activeValue(value: string) { if (this.confirmMode && this.pin.length === 4) this.confirmPin = value; else this.pin = value; }
  get ready(): boolean { return /^\d{4}$/.test(this.pin) && (!this.confirmMode || /^\d{4}$/.test(this.confirmPin)); }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    if (event.key >= '0' && event.key <= '9') this.press(Number(event.key));
    if (event.key === 'Backspace') this.remove();
    if (event.key === 'Escape') this.clear();
    if (event.key === 'Enter' && this.ready) this.submit();
  }

  press(num: number): void { if (this.activeValue.length < 4) { this.error = ''; this.activeValue = `${this.activeValue}${num}`; } }
  remove(): void { this.error = ''; this.activeValue = this.activeValue.slice(0, -1); }
  clear(): void { this.error = ''; this.pin = ''; this.confirmPin = ''; }

  submit(): void {
    this.error = '';
    if (!this.ready) { this.error = 'Enter all four digits.'; return; }
    if (this.confirmMode && this.pin !== this.confirmPin) { this.error = 'PIN entries must match.'; this.confirmPin = ''; return; }
    this.pinSubmit.emit(this.pin);
  }
}