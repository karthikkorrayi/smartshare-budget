import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PinLockService } from '../../services/pin-lock.service';

@Component({
  selector: 'app-pin-lock',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pin-lock.component.html',
  styleUrl: './pin-lock.component.scss',
})
export class PinLockComponent {
  pin = '';
  
  error = false;

  numbers = [1,2,3,4,5,6,7,8,9];

  constructor(public pinService: PinLockService){
    this.pinService.setPin('1234');
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    this.onKey(event);
  }

  // Dial pad press
  press(num: number) {
    if (this.pin.length >= 4) return;
    this.pin += num;
    this.checkAutoUnlock();
  }

  // Backspace
  remove() {
    this.pin = this.pin.slice(0, -1);
  }

  // Auto verify when 4 digits entered
  checkAutoUnlock() {
    if (this.pin.length === 4) {
      setTimeout(() => {
        const ok = this.pinService.verifyPin(this.pin);
        if (!ok) {
          this.error = true;
          this.pin = '';
          setTimeout(() => this.error = false, 1200);
        }
      }, 150);
    }
  }

  // Keyboard support
  onKey(event: KeyboardEvent) {
    if (event.key >= '0' && event.key <= '9') {
      this.press(Number(event.key));
    }
    if (event.key === 'Backspace') {
      this.remove();
    }
  }
}
