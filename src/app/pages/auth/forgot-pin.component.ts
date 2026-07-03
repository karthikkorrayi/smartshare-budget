import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
@Component({selector:'app-forgot-pin',standalone:true,imports:[CommonModule,FormsModule,RouterLink],template:`<section class="auth-shell"><div class="auth-card"><h1>Forgot PIN</h1><p>Enter Email Address</p><form (ngSubmit)="send()"><input name="email" type="email" [(ngModel)]="email" placeholder="you@example.com"><button class="primary-btn" [disabled]="busy">{{busy?'Sending…':'Send reset link'}}</button></form><p class="success" *ngIf="sent">If an account exists, a reset link has been sent.</p><a routerLink="/unlock">Back to unlock</a></div></section>`})
export class ForgotPinComponent{auth=inject(AuthService); email=''; busy=false; sent=false; async send(){this.busy=true; await this.auth.requestPinReset(this.email); this.sent=true; this.busy=false;}}