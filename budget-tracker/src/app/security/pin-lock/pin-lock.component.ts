import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
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

  constructor(public pinService: PinLockService){
    this.pinService.setPin('1234');
  }

  unlock(){
    this.error = !this.pinService.verifyPin(this.pin);
    this.pin = '';
  }

}
