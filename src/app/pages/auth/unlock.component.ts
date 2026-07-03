import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PinFormComponent } from './pin-form.component';

@Component({ selector:'app-unlock', standalone:true, imports:[CommonModule, RouterLink, PinFormComponent], template:`
<section class="auth-shell"><div class="auth-card"><img class="avatar" [src]="auth.profile()?.photoURL || 'assets/avatar.svg'" alt="Profile"><h1>Welcome Back</h1><p>{{ auth.profile()?.displayName }}</p><app-pin-form label="Enter PIN" buttonText="Unlock" [confirmMode]="false" [busy]="busy" (pinSubmit)="unlock($event)"></app-pin-form><p class="auth-error" *ngIf="error">{{ error }}</p><div class="auth-links"><a routerLink="/forgot-pin">Forgot PIN</a><button type="button" (click)="auth.logout()">Sign Out</button></div></div></section>` })
export class UnlockComponent { auth=inject(AuthService); router=inject(Router); busy=false; error=''; async unlock(pin:string){this.error=''; this.busy=true; const ok=await this.auth.verifyPin(pin); this.busy=false; if(ok) await this.router.navigateByUrl('/dashboard'); else this.error='Invalid PIN';} }