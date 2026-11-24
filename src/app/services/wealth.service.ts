import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, shareReplay } from 'rxjs';
import { FinanceService } from './finance.service';
import { LoanService } from './loan.service';
import { NetWorth, netWorth } from '../utils/wealth.util';

/** Net worth by category, live: accounts, lending, loans and EMI payments. */
@Injectable({ providedIn: 'root' })
export class WealthService {
  private finance = inject(FinanceService);
  private loans = inject(LoanService);

  readonly netWorth$: Observable<NetWorth> = combineLatest([this.finance.accounts$, this.finance.lending$, this.loans.loans$, this.finance.recurring$]).pipe(
    map(([accounts, lending, loans, plans]) => netWorth(accounts, lending, loans, plans)),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
