# SmartShare Budget — UI/UX redesign (branch `feature/ui-redesign`)

## What changed for the user
- **New app shell**: collapsible sidebar (desktop), bottom navigation + quick-add button (phones), top bar with
  Income / Expense quick actions, theme switch, notification panel and profile menu.
- **Three primary sections**: Dashboard, Recurring, Review. Cards, wallets, statements, Gmail sync,
  notifications and settings are all still reachable (sidebar → Accounts / Connections, and the profile menu).
- **Light / Dark / System themes**, saved per device, applied before first paint. Every colour is a token
  (`src/styles/_tokens.scss`); existing pages were converted to the tokens so they work in dark mode too.
- **No emojis**: Lucide icons (`lucide` package, rendered by `<app-icon>`) everywhere, including model icon maps
  and push-notification titles.
- **Dashboard**: global date filter (today → custom range, max 24 months) + account filter; Total wealth, Income,
  Expenses, Net cash flow, Money owed to you, Upcoming 30 days; 3D-style account cards; cash-flow chart and
  12-month trends with click-to-breakdown; category doughnut; daily spending insight; monthly budget pace (the
  original Overview hero); upcoming bills; lending/borrowing ledger; discipline streaks + 5-week calendar.
- **Account pages** (`#/account/:type/:id`): balance, money in vs spending chart with drill-down, distribution,
  searchable/sortable transactions.
- **Recurring payments** (`#/recurring`): overview tiles, Upcoming / Due today / Overdue / Paid / All tabs,
  search, frequency filter, sort, details panel with schedule, history, pause/resume, skip, mark paid.
- **Review** (`#/review`): new Activity workspace (All, Expenses, Income, Transfers & moves, Lending & borrowing
  with partial repayments, Categories, Account activity) + the existing Gmail Review Center as the **Email inbox**
  tab (`#/review/inbox`). Notification links to `/review` open the inbox.
- **Account-dependent entries**: one Add dialog for Expense / Income / Transfer. The account is chosen first;
  balance after the entry is shown, and going below zero needs an explicit "Record anyway".
- **PWA**: `manifest.webmanifest`, icons, offline page, and the existing `firebase-messaging-sw.js` now also
  caches the shell (network-first pages, cache-first hashed assets; Firestore/Auth never cached). The
  "Install app" action only appears when the browser fires `beforeinstallprompt`.
- Branded splash screen, skeleton loaders, button spinners, reduced-motion support, skip link, ARIA labels,
  and a banner when a Firestore query fails (instead of silently showing zeros).

## Backend / data-model changes (all additive — no migration, old documents keep working)
| Change | Where |
|---|---|
| New collection `bank_accounts` (name, institution, kind, optional last-4, openingBalance, status). Balance is derived, never stored. | `firestore.rules`, `BankAccountsService` |
| New collection `transfers` (bank ↔ wallet). Never income or spending. | `firestore.rules`, `TransfersService` |
| `expenses` / `income` gain optional `accountType` + `accountId` (+ `notes`, `recurringId`). Rules check the account belongs to the caller. Unlinked legacy entries still count in the budget exactly as before. | `firestore.rules`, `LedgerService` |
| Expenses paid by **card** are written as `card_transactions` (debit); by **wallet** as `wallet_transactions` (spend) — through the existing services, so spending limits, review links and rules are unchanged. | `LedgerService` |
| Wallet balance now also includes income received into the wallet and transfers. | `WalletsService.views$` |
| `upcoming_payments` gain optional `frequency`, `intervalDays`, `anchorDay`, `accountType/Id`, `reminderDays`, `paused`, `history`, `lastPaidAt`. No `frequency` = one-time (old behaviour: pay → expense + removed). | `recurring.model.ts`, `LedgerService` |
| `receivables` gain optional `direction` (lent/borrowed), `date`, `dueDate`, `settledAmount`, `history`, `notes`, `accountType/Id`. Borrowed money is ledger-only. | `lending.model.ts`, `LedgerService` |
| Cloud Function `dailyDueDigest` now also reminds about bills / recurring payments (per-payment reminder window, paused skipped) and no longer skips users without cards. Push titles have no emojis. | `functions/src/reminders.ts`, `functions/src/index.ts` |
| Client reminders (bell + Notifications page) add bill and lending-repayment reminders, deduplicated by key. | `NotificationsService` |

**Preserved**: carry-forward (still runs on Dashboard load for the current month; duplicate cleanup and
system-entry protection unchanged; carry-forward is excluded from multi-month income totals so it is not
double-counted), Undo for every action, review-approval batch rules, spending-limit warnings, Gmail sync.

## Tests
- `functions`: 48 passing (4 new bill-reminder tests).
- Angular unit tests: the 4 old placeholder specs referenced classes that never existed and could not compile;
  replaced by `src/app/utils/analytics.util.spec.ts` (9 tests: totals, carry-forward exclusion, balance effects,
  categories, daily insight, ranges, streaks, recurring schedule, legacy-document reads).
- Firestore rules: new suites for `bank_accounts`, account-linked entries and `transfers` in
  `tests/firestore-rules/rules.test.mjs` (run with `npm run test:rules`; needs Java + emulator).

## Deploy order
1. `firestore:rules,firestore:indexes` (new collections are denied until the new rules are live)
2. `functions` (bill reminders in the daily digest)
3. `hosting`
