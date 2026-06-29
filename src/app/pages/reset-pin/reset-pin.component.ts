import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-reset-pin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="reset-container">
      <h2>Reset Your PIN</h2>
      <input type="password" [(ngModel)]="newPin" placeholder="New PIN" maxlength="4" />
      <input type="password" [(ngModel)]="confirmPin" placeholder="Confirm PIN" maxlength="4" />
      <button (click)="resetPin()">Update PIN</button>
      <p *ngIf="message" [class.success]="success">{{ message }}</p>
    </div>
  `
})
export class ResetPinComponent implements OnInit {
  newPin = '';
  confirmPin = '';
  message = '';
  success = false;
  token = '';

  constructor(private authService: AuthService, private route: ActivatedRoute) {}

  ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
  }

  async resetPin() {
    if (this.newPin !== this.confirmPin) {
      this.message = 'PINs do not match';
      this.success = false;
      return;
    }

    try {
      await this.authService.resetPin(this.token, this.newPin);
      this.message = 'PIN updated successfully!';
      this.success = true;
    } catch (error: any) {
      this.message = error.message;
      this.success = false;
    }
  }
}