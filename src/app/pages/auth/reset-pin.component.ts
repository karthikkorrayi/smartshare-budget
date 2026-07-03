import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PinFormComponent } from './pin-form.component';
@Component({selector:'app-reset-pin',standalone:true,imports:[CommonModule,PinFormComponent],template:`<section class="auth-shell"><div class="auth-card"><h1>Create New PIN</h1><app-pin-form label="Create New PIN" buttonText="Update PIN" [busy]="busy" (pinSubmit)="save($event)"></app-pin-form><p class="success" *ngIf="success">PIN Updated Successfully</p><p class="auth-error" *ngIf="error">{{error}}</p></div></section>`})
export class ResetPinComponent{auth=inject(AuthService); route=inject(ActivatedRoute); router=inject(Router); busy=false; success=false; error=''; async save(pin:string){this.busy=true; const ok=await this.auth.resetPin(this.route.snapshot.paramMap.get('token') || '', pin); this.busy=false; if(ok){this.success=true; setTimeout(()=>this.router.navigateByUrl('/login'),900);} else this.error='This reset link is invalid or expired.';}}