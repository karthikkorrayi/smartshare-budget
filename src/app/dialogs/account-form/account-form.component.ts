import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { BankAccountsService } from '../../services/bank-accounts.service';
import { UndoService } from '../../services/undo.service';
import { ConfirmService } from '../../ui/confirm.service';
import { BANK_KINDS, BANK_KIND_LABEL, BankAccount, BankKind } from '../../models/account.model';
import { IconComponent } from '../../ui/icon.component';

/** Add / edit / delete a bank account. */
@Component({
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="dlg" role="dialog" aria-modal="true" [attr.aria-label]="existing() ? 'Edit bank account' : 'Add bank account'">
      <div class="dlg-head">
        <span class="icon-tile lg accent"><app-icon name="landmark" [size]="22" /></span>
        <div>
          <h2>{{ existing() ? 'Edit bank account' : 'Add bank account' }}</h2>
          <p>Only a name and balance are needed. Never enter a full account number.</p>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm close" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </div>

      <div class="dlg-body">
        <div class="form-grid">
          <label class="field span-2"><span>Account name</span>
            <input type="text" maxlength="40" [(ngModel)]="name" placeholder="e.g. HDFC Savings" /></label>
          <label class="field"><span>Bank</span>
            <input type="text" maxlength="60" [(ngModel)]="institution" placeholder="e.g. HDFC Bank" /></label>
          <label class="field"><span>Type</span>
            <select [(ngModel)]="kind">@for (k of kinds; track k) { <option [value]="k">{{ kindLabel[k] }}</option> }</select></label>
          <label class="field"><span>Last 4 digits (optional)</span>
            <input type="text" inputmode="numeric" maxlength="4" [(ngModel)]="lastFour" placeholder="1234" /></label>
          <label class="field"><span>{{ existing() ? 'Opening balance' : 'Current balance' }}</span>
            <input type="number" step="0.01" inputmode="decimal" [(ngModel)]="openingBalance" placeholder="0" />
            <small>{{ existing() ? 'Balance before the entries recorded in the app.' : 'What the account holds today. New entries move it from here.' }}</small></label>
          @if (existing()) {
            <label class="field span-2 check"><input type="checkbox" [(ngModel)]="closed" /> <span>Account closed (kept for history, excluded from total wealth)</span></label>
          }
        </div>
        @if (error()) { <div class="alert neg" role="alert"><app-icon name="circle-alert" [size]="16" /><span>{{ error() }}</span></div> }
      </div>

      <div class="dlg-foot">
        @if (existing()) { <button class="btn btn-ghost btn-danger-text" (click)="remove()" [disabled]="saving()"><app-icon name="trash2" [size]="16" />Delete</button> }
        <span class="spacer"></span>
        <button class="btn" (click)="ref.close()" [disabled]="saving()">Cancel</button>
        <button class="btn btn-primary" (click)="save()" [disabled]="saving()">
          @if (saving()) { <span class="spinner"></span> Saving… } @else { {{ existing() ? 'Save changes' : 'Add account' }} }
        </button>
      </div>
    </div>
  `,
  styles: [`.check { flex-direction: row !important; align-items: center; gap: 10px !important; span { font-weight: 500 !important; } }`],
})
export class AccountFormComponent {
  ref = inject(MatDialogRef<AccountFormComponent>);
  private banks = inject(BankAccountsService);
  private undo = inject(UndoService);
  private confirm = inject(ConfirmService);
  private data = inject<{ id?: string }>(MAT_DIALOG_DATA) ?? {};

  readonly kinds = BANK_KINDS;
  readonly kindLabel = BANK_KIND_LABEL;
  existing = signal<BankAccount | null>(null);
  name = '';
  institution = '';
  kind: BankKind = 'savings';
  lastFour = '';
  openingBalance: number | null = null;
  closed = false;
  saving = signal(false);
  error = signal('');

  constructor() {
    if (this.data.id) {
      firstValueFrom(this.banks.accounts$).then(list => {
        const a = list.find(x => x.id === this.data.id);
        if (!a) return;
        this.existing.set(a);
        this.name = a.name;
        this.institution = a.institution;
        this.kind = a.kind;
        this.lastFour = a.lastFour;
        this.openingBalance = a.openingBalance;
        this.closed = a.status === 'Closed';
      });
    }
  }

  async save(): Promise<void> {
    if (!this.name.trim()) return this.error.set('Give the account a name.');
    if (this.lastFour && !/^[0-9]{4}$/.test(this.lastFour.trim())) return this.error.set('Last 4 digits must be exactly 4 numbers (or leave it empty).');
    const bal = Number(this.openingBalance ?? 0);
    if (!Number.isFinite(bal) || Math.abs(bal) >= 1e9) return this.error.set('Enter a valid balance.');
    this.error.set('');
    this.saving.set(true);
    const input = { name: this.name, institution: this.institution, kind: this.kind, lastFour: this.lastFour, openingBalance: bal, status: this.closed ? 'Closed' as const : 'Active' as const };
    try {
      const ex = this.existing();
      if (ex) {
        await this.banks.update(ex.id, input);
        this.undo.offer(`Updated ${input.name}`, () => this.banks.update(ex.id, ex));
      } else {
        const r = await this.banks.add(input);
        this.undo.offer(`Added ${input.name}`, () => this.banks.delete(r.id));
      }
      this.ref.close(true);
    } catch (e) {
      console.error('[AccountForm] save failed', e);
      this.error.set('Could not save. Check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    const ex = this.existing();
    if (!ex) return;
    const ok = await this.confirm.ask({
      title: `Delete ${ex.name}?`,
      message: 'Its income and expenses stay in your budget but are no longer linked to an account. Transfers to or from it are removed. This cannot be undone.',
      confirm: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      await this.banks.delete(ex.id);
      this.ref.close(true);
    } catch (e) {
      console.error('[AccountForm] delete failed', e);
      this.error.set('Could not delete the account. Try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
