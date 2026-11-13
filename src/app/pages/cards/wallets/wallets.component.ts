import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { switchMap } from 'rxjs';
import { WalletsService, WalletView } from '../../../services/wallets.service';
import { WALLET_KIND_INFO, WALLET_TXN_INFO, Wallet, WalletTransaction, WalletTxnType, balanceEffect } from '../../../models/wallet.model';
import { WalletFormComponent, WalletFormData } from '../../../dialogs/wallet-form/wallet-form.component';
import { WalletTxnFormComponent, WalletTxnFormData } from '../../../dialogs/wallet-txn-form/wallet-txn-form.component';
import { monthKey, toDateInput } from '../../../utils/date-input.util';
import { UndoService } from '../../../services/undo.service';
import { IconComponent } from '../../../ui/icon.component';

const DIALOG = { width: 'min(94vw, 540px)', maxWidth: '96vw', autoFocus: 'first-tabbable' as const };

interface DayGroup {
  key: string;
  date: Date;
  items: WalletTransaction[];
}

@Component({
  selector: 'app-wallets',
  standalone: true,
  imports: [IconComponent, DatePipe, DecimalPipe],
  templateUrl: './wallets.component.html',
  styleUrl: './wallets.component.scss',
})
export class WalletsComponent {
  private walletsService = inject(WalletsService);
  private dialog = inject(MatDialog);
  private undo = inject(UndoService);

  readonly kindInfo = WALLET_KIND_INFO;
  readonly txnInfo = WALLET_TXN_INFO;
  readonly effect = balanceEffect;

  private rawWallets = toSignal(this.walletsService.views$);
  loading = computed(() => this.rawWallets() === undefined);
  showClosed = signal(false);
  selected = signal<string>('all');
  month = signal(monthKey());
  confirmDeleteId = signal<string | null>(null);

  /** Wallets held for Undo (being deleted) disappear straight away. */
  wallets = computed(() => (this.rawWallets() ?? []).filter(w => !this.undo.hidden().has(w.id)));
  visible = computed(() => this.wallets().filter(w => this.showClosed() || w.status === 'Active'));
  closedCount = computed(() => this.wallets().filter(w => w.status === 'Closed').length);
  private walletMap = computed(() => new Map(this.wallets().map(w => [w.id, w])));

  private monthTxns = toSignal(toObservable(this.month).pipe(switchMap(m => this.walletsService.byMonth$(m))), {
    initialValue: [] as WalletTransaction[],
  });

  filtered = computed(() =>
    this.monthTxns().filter(
      t => this.walletMap().has(t.walletId) && (this.selected() === 'all' || t.walletId === this.selected()) && !this.undo.hidden().has(t.id)
    )
  );

  groups = computed<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>();
    for (const t of this.filtered()) {
      const key = toDateInput(t.date);
      const g = map.get(key) ?? { key, date: t.date, items: [] };
      g.items.push(t);
      map.set(key, g);
    }
    return [...map.values()];
  });

  totals = computed(() => {
    const active = this.wallets().filter(w => w.status === 'Active');
    const list = this.filtered();
    const sum = (type: WalletTxnType) => list.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);
    return {
      balance: active.reduce((s, w) => s + w.balance, 0),
      low: active.filter(w => w.low).length,
      spent: sum('spend') - sum('refund'),
      toppedUp: sum('topup'),
      cashback: sum('cashback'),
    };
  });

  spentThisMonth(walletId: string): number {
    return this.monthTxns()
      .filter(t => t.walletId === walletId)
      .reduce((s, t) => s + (t.type === 'spend' ? t.amount : t.type === 'refund' ? -t.amount : 0), 0);
  }

  walletName(id: string): string {
    const w = this.walletMap().get(id);
    return w ? w.name : 'Deleted wallet';
  }

  isCurrentMonth(): boolean {
    return this.month() === monthKey();
  }

  shiftMonth(delta: number): void {
    const [y, m] = this.month().split('-').map(Number);
    this.month.set(monthKey(new Date(y, m - 1 + delta, 1)));
  }

  select(id: string): void {
    this.selected.update(cur => (cur === id ? 'all' : id));
  }

  addWallet(): void {
    this.dialog.open<WalletFormComponent, WalletFormData>(WalletFormComponent, { ...DIALOG, data: {} });
  }

  editWallet(w: Wallet): void {
    this.dialog.open<WalletFormComponent, WalletFormData>(WalletFormComponent, { ...DIALOG, data: { wallet: w } });
  }

  record(type: WalletTxnType, walletId?: string): void {
    const sel = this.selected();
    this.dialog.open<WalletTxnFormComponent, WalletTxnFormData>(WalletTxnFormComponent, {
      ...DIALOG,
      data: { wallets: this.wallets(), type, walletId: walletId ?? (sel === 'all' ? undefined : sel) },
    });
  }

  editTxn(txn: WalletTransaction): void {
    this.dialog.open<WalletTxnFormComponent, WalletTxnFormData>(WalletTxnFormComponent, { ...DIALOG, data: { wallets: this.wallets(), txn } });
  }

  removeTxn(t: WalletTransaction): void {
    this.undo.defer(`Deleted "${t.description}" · ₹${t.amount}`, [t.id], () => this.walletsService.deleteTxn(t.id));
  }

  /** Wallet + its entries are removed after 5 s; Undo cancels. */
  confirmDelete(w: WalletView): void {
    this.confirmDeleteId.set(null);
    if (this.selected() === w.id) this.selected.set('all');
    this.undo.defer(`Deleted wallet ${w.name} and its entries`, [w.id], () => this.walletsService.deleteWithHistory(w.id));
  }
}
