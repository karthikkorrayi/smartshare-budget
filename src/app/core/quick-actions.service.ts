import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AccountRef } from '../models/account.model';
import { FinanceTxn } from '../utils/analytics.util';

export type TxnMode = 'expense' | 'income' | 'transfer';

/** Opens the app's dialogs from anywhere (top bar, FAB, dashboard, Review, account pages). Lazy-loaded. */
@Injectable({ providedIn: 'root' })
export class QuickActionsService {
  private dialog = inject(MatDialog);

  async addTxn(mode: TxnMode = 'expense', account: AccountRef | null = null) {
    const { TxnDialogComponent } = await import('../dialogs/txn-dialog/txn-dialog.component');
    return this.dialog.open(TxnDialogComponent, { data: { mode, account }, width: 'min(96vw, 560px)', panelClass: 'ss-sheet-pane', autoFocus: 'first-tabbable' });
  }

  async editTxn(txn: FinanceTxn) {
    const { TxnDialogComponent } = await import('../dialogs/txn-dialog/txn-dialog.component');
    return this.dialog.open(TxnDialogComponent, { data: { txn }, width: 'min(96vw, 560px)', panelClass: 'ss-sheet-pane', autoFocus: 'first-tabbable' });
  }

  async showTxn(txn: FinanceTxn) {
    const { TxnDetailComponent } = await import('../dialogs/txn-detail/txn-detail.component');
    return this.dialog.open(TxnDetailComponent, { data: { txn }, width: 'min(100vw, 440px)', panelClass: 'ss-drawer-pane', autoFocus: 'dialog' });
  }

  async addAccount(type: 'bank' | 'wallet' | 'card' = 'bank') {
    if (type === 'bank') {
      const { AccountFormComponent } = await import('../dialogs/account-form/account-form.component');
      return this.dialog.open(AccountFormComponent, { data: {}, width: 'min(96vw, 520px)', panelClass: 'ss-sheet-pane' });
    }
    if (type === 'wallet') {
      const { WalletFormComponent } = await import('../dialogs/wallet-form/wallet-form.component');
      return this.dialog.open(WalletFormComponent, { data: {}, width: 'min(96vw, 520px)', panelClass: 'ss-sheet-pane' });
    }
    const { CardFormComponent } = await import('../dialogs/card-form/card-form.component');
    return this.dialog.open(CardFormComponent, { data: {}, width: 'min(96vw, 560px)', panelClass: 'ss-sheet-pane' });
  }

  async editBank(id: string) {
    const { AccountFormComponent } = await import('../dialogs/account-form/account-form.component');
    return this.dialog.open(AccountFormComponent, { data: { id }, width: 'min(96vw, 520px)', panelClass: 'ss-sheet-pane' });
  }

  async recurring(id: string | null = null) {
    const { RecurringFormComponent } = await import('../dialogs/recurring-form/recurring-form.component');
    return this.dialog.open(RecurringFormComponent, { data: { id }, width: 'min(96vw, 560px)', panelClass: 'ss-sheet-pane' });
  }

  async lending(direction: 'lent' | 'borrowed' = 'lent') {
    const { LendingFormComponent } = await import('../dialogs/lending-form/lending-form.component');
    return this.dialog.open(LendingFormComponent, { data: { direction }, width: 'min(96vw, 520px)', panelClass: 'ss-sheet-pane' });
  }
}
