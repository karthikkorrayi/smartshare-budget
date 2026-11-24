# SmartShare Budget — enhancement phases

Delivered one phase at a time on top of the redesign (`REDESIGN_CHANGES.md`). Each phase is additive:
no data migration, existing documents keep working.

## Phase 1 — UI foundation, balance privacy, dates
- **Balances hidden by default** (`core/privacy.service.ts`, `ui/amount.component.ts`): every balance shows
  `₹ ******` with its own eye button — total wealth, each bank account / wallet / card, wallet and card totals,
  money owed to you, and the month's "Left" amount. The same account is shown/hidden the same way on every
  screen (key = `bank:<id>`, `wallet:<id>`, `card:<id>`, `wealth`…). Nothing is stored: reopening the app hides
  everything. A "Hide all" eye appears in the top bar while anything is revealed. Account pickers in the entry
  dialog follow the same state (`privateMoney` pipe). Flows (income, expenses for a period) stay visible.
- **Themed controls**: `<app-select>` (anchored panel on desktop, bottom sheet on phones, keyboard + type-ahead,
  search for long lists, icons/hints per option) and `<app-date>` (calendar with Monday-first weeks, min/max,
  quick chips, month mode). They replace the native `<select>` / `<input type=date|month>` on the dashboard and
  activity filters, recurring/transaction-table filters, card transactions/statements/wallets pages, the
  Add/Edit entry dialog, wallet entry, card transaction, statement and account forms, Review Center and Profile.
  Card, bill and lending forms get them when they are rebuilt (Phases 2–4).
- **Dates**: one rule for stored moments (`utils/date-input.util.ts`): `entryMoment` (edits keep their original
  time; today → now; other days → 12:00 local) and `dueMoment` (12:00 local). Midnight is no longer stored, so a
  day can't shift when read in UTC. `checkDay` validates required / not-future / range / typo years.
  `fromDateInput` now rejects impossible dates (2026-02-31 used to become 3 March).
- **Consistency**: legacy `cc-*` styles now use the design-system sizes, radii and type scale; Notifications
  shows real icons (it printed icon names as text); text glyphs (`+`, `‹ ›`, `›`) replaced by icons.
- **Tests**: `date-input.util.spec.ts`, `privacy.service.spec.ts` (privacy, `<app-amount>`, opts pipe),
  `select.component.spec.ts` (select + date picker). `angular.json` test target now loads zone.js, which
  TestBed needs. Run: `npx ng test --watch=false`.
