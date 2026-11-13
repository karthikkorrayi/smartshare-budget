import { Component, Injectable, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from './icon.component';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
  icon?: string;
}

@Component({
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="dlg" role="alertdialog" aria-modal="true" [attr.aria-label]="d.title">
      <div class="dlg-head">
        <span class="icon-tile lg" [class.neg]="d.danger" [class.accent]="!d.danger"><app-icon [name]="d.icon ?? (d.danger ? 'alert-triangle' : 'info')" [size]="22" /></span>
        <div>
          <h2>{{ d.title }}</h2>
          <p>{{ d.message }}</p>
        </div>
      </div>
      <div class="dlg-foot">
        <button class="btn" (click)="ref.close(false)">{{ d.cancel ?? 'Cancel' }}</button>
        <button class="btn" [class.btn-danger]="d.danger" [class.btn-primary]="!d.danger" (click)="ref.close(true)" cdkFocusInitial>
          {{ d.confirm ?? 'Confirm' }}
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  d = inject<ConfirmOptions>(MAT_DIALOG_DATA);
  ref = inject(MatDialogRef<ConfirmDialogComponent>);
}

/** Promise-based confirmation for destructive actions. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private dialog = inject(MatDialog);

  ask(o: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, { data: o, width: 'min(92vw, 440px)', autoFocus: 'dialog', restoreFocus: true });
    return firstValueFrom(ref.afterClosed()).then(v => !!v);
  }
}
