import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PinFormComponent } from './pin-form.component';

@Component({ selector:'app-setup-pin', standalone:true, imports:[CommonModule, PinFormComponent], template:`
<section class="auth-shell"><div class="auth-card"><img class="avatar" [src]="auth.profile()?.photoURL || 'assets/avatar.svg'" alt="Profile"><h1>Create 4 Digit PIN</h1><p>{{ auth.profile()?.displayName }}</p><p class="muted">{{ auth.profile()?.email }}</p><app-pin-form [busy]="busy" (pinSubmit)="save($event)"></app-pin-form><p class="success" *ngIf="done">Setup Complete</p></div></section>` })
export class SetupPinComponent { auth=inject(AuthService); router=inject(Router); busy=false; done=false; async save(pin:string){this.busy=true; await this.auth.completePinSetup(pin); this.done=true; setTimeout(()=>this.router.navigateByUrl('/dashboard'),700);} }