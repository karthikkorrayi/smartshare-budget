import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { WALLET_KINDS, WALLET_KIND_INFO, WALLET_PROVIDERS, Wallet, WalletInput, WalletKind } from '../../models/wallet.model';
import { WalletsService } from '../../services/wallets.service';
import { UndoService } from '../../services/undo.service';
import { IconComponent } from '../../ui/icon.component';

export interface WalletFormData {
  wallet?: Wallet;
}

@Component({
  selector: 'app-wallet-form',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="cc-dialog">
      <div class="cc-dialog-head">
        <span class="icon" aria-hidden="true"><app-icon name="wallet" [size]="22" /></span>
        <div>
          <h2>{{ isEdit ? 'Edit wallet' : 'Add a wallet' }}</h2>
          <p>Cash, a UPI app wallet or a prepaid card. Its balance is worked out from what you record.</p>
        </div>
      </div>

      <form class="cc-dialog-body" (ngSubmit)="save()" novalidate>
        <div class="kinds" role="radiogroup" aria-label="Wallet type">
          @for (k of kinds; track k) {
            <button type="button" class="kind" role="radio" [attr.aria-checked]="form.kind === k" [class.active]="form.kind === k" (click)="setKind(k)">
              <span class="k-icon" aria-hidden="true"><app-icon [name]="kindInfo[k].icon" [size]="20" /></span>
              <span class="k-label">{{ kindInfo[k].label }}</span>
              <small>{{ kindInfo[k].hint }}</small>
            </button>
          }
        </div>

        <div class="cc-row">
          <label class="cc-field">
            <span>Name</span>
            <input name="name" maxlength="40" placeholder="e.g. Paytm, Cash at home" [(ngModel)]="form.name" />
          </label>
          @if (form.kind === 'upi' || form.kind === 'prepaid') {
            <label class="cc-field">
              <span>Provider (optional)</span>
              <input name="provider" maxlength="40" list="wallet-providers" placeholder="Paytm, Amazon Pay…" [(ngModel)]="form.provider" />
              <datalist id="wallet-providers">
                @for (p of providers; track p) { <option [value]="p"></option> }
              </datalist>
            </label>
          }
        </div>

        <div class="cc-row">
          <label class="cc-field">
            <span>{{ isEdit ? 'Starting balance' : 'Balance right now (₹)' }}</span>
            <input name="openingBalance" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" [(ngModel)]="form.openingBalance" />
          </label>
          <label class="cc-field">
            <span>Warn me below (₹, optional)</span>
            <input name="lowBalanceAlert" type="number" min="0" step="1" inputmode="decimal" placeholder="e.g. 200" [(ngModel)]="form.lowBalanceAlert" />
          </label>
        </div>
        @if (isEdit) {
          <p class="cc-hint">The starting balance is what the wallet held before your first entry here. Changing it shifts the current balance by the same amount.</p>
          <label class="cc-check">
            <input type="checkbox" name="closed" [(ngModel)]="closed" /> Closed (hide it; history stays)
          </label>
        }

        @if (errors().length) {
          <ul class="cc-errors" role="alert">
            @for (e of errors(); track e) { <li>{{ e }}</li> }
          </ul>
        }

        <div class="cc-dialog-actions">
          <button type="button" class="cc-btn" (click)="close()" [disabled]="saving()">Cancel</button>
          <button type="submit" class="cc-btn cc-btn--primary" [disabled]="saving()">
            {{ saving() ? 'Saving…' : isEdit ? 'Update' : 'Add wallet' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
    .kind {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; text-align: left;
      border: 1px solid var(--border); border-radius: 12px; background: var(--surface); cursor: pointer; font: inherit; color: var(--text);
      &.active { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent) inset; }
      .k-icon { font-size: 20px; } .k-label { font-weight: 700; font-size: 14px; } small { color: var(--text-3); font-size: 12px; }
    }
    .cc-hint { margin: -4px 0 10px; font-size: 12px; color: var(--text-3); }
    .cc-check { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-2); margin-bottom: 10px; }
  `],
})
export class WalletFormComponent {
  private dialogRef = inject(MatDialogRef<WalletFormComponent>);
  private wallets = inject(WalletsService);
  private undo = inject(UndoService);
  data: WalletFormData = inject(MAT_DIALOG_DATA) ?? {};

  readonly kinds = WALLET_KINDS;
  readonly kindInfo = WALLET_KIND_INFO;
  readonly providers = WALLET_PROVIDERS;
  isEdit = !!this.data.wallet;
  saving = signal(false);
  errors = signal<string[]>([]);
  closed = this.data.wallet?.status === 'Closed';

  form = {
    name: this.data.wallet?.name ?? '',
    kind: (this.data.wallet?.kind ?? 'upi') as WalletKind,
    provider: this.data.wallet?.provider ?? '',
    openingBalance: this.data.wallet?.openingBalance ?? (null as number | null),
    lowBalanceAlert: this.data.wallet?.lowBalanceAlert || (null as number | null),
  };

  setKind(k: WalletKind): void {
    this.form.kind = k;
    if (k === 'cash' && !this.form.name.trim()) this.form.name = 'Cash';
  }

  close(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    const f = this.form;
    const out: string[] = [];
    if (!f.name.trim()) out.push('Give the wallet a name.');
    if (f.openingBalance !== null && !(Number(f.openingBalance) >= 0)) out.push('Balance can’t be negative.');
    if (f.lowBalanceAlert !== null && !(Number(f.lowBalanceAlert) >= 0)) out.push('The warning amount can’t be negative.');
    this.errors.set(out);
    if (out.length) return;

    const input: WalletInput = {
      name: f.name,
      kind: f.kind,
      provider: f.kind === 'upi' || f.kind === 'prepaid' ? f.provider : '',
      openingBalance: Number(f.openingBalance) || 0,
      lowBalanceAlert: Number(f.lowBalanceAlert) || 0,
      status: this.closed ? 'Closed' : 'Active',
    };
    this.saving.set(true);
    try {
      if (this.isEdit) {
        const b = this.data.wallet!;
        await this.wallets.updateWallet(b.id, input);
        this.undo.offer(`Updated ${input.name}`, () => this.wallets.updateWallet(b.id, b));
      } else {
        const ref = await this.wallets.addWallet(input);
        this.undo.offer(`Added wallet ${input.name}`, () => this.wallets.deleteWithHistory(ref.id));
      }
      this.dialogRef.close(true);
    } catch (err) {
      console.error('[WalletForm] save failed', err);
      this.errors.set(['Could not save the wallet. Check the values and your connection.']);
    } finally {
      this.saving.set(false);
    }
  }
}
