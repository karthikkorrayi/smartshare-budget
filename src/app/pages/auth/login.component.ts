import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({ selector: 'app-login', standalone: true, imports: [CommonModule], template: `
<section class="auth-shell"><div class="auth-card hero"><div class="brand-mark">💰</div><h1>SmartShare Budget</h1><p>Welcome back. Track smarter, spend better.</p><button class="primary-btn google" (click)="login()" [disabled]="busy">{{ busy ? 'Opening Google…' : 'Continue with Google' }}</button><p class="auth-error" *ngIf="error">{{ error }}</p></div></section>` })
export class LoginComponent { auth=inject(AuthService); busy=false; error=''; async login(){ try{this.busy=true; await this.auth.signInWithGoogle();}catch{this.error='Google sign in failed. Please try again.';}finally{this.busy=false;} } }