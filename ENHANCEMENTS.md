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

## Phase 2 — Complete card management
- **Card details** (`models/card.model.ts`, all optional so older cards keep working): network, tier, card
  colour, credit and cash limits, outstanding-as-of (for cards added mid-cycle), interest per month, annual
  fee + waiver spend, late fee, cash-withdrawal fee, forex markup, reward type / rate / balance / point value,
  benefit tags (preset + your own), notes, autopay, usage alert. Validated in `firestore.rules`
  (`isValidCardDetails`); never a card number.
- **One definition of what a card owes** (`cardPosition`, shared through `CardInsightsService`):
  - with a statement: unpaid statements + spends − refunds dated after the latest statement
    (bill payments are tracked on statements, so they're not subtracted twice);
  - before the first statement: the outstanding you entered + spends − every credit since its date;
  - available = limit − used (negative = over limit), % used, spend this cycle / last 12 months.
  The dashboard card tiles, Cards page, card page and usage reminders all use it. A card's balance on the
  dashboard is now "owed now" (billed + unbilled) instead of unpaid statements only.
- **Add / edit card** is a 4-step flow (Card · Limits & billing · Costs & rewards · Settings) with a live card
  preview, network/reward selection tiles, colour swatches, themed day/month pickers, a billing-cycle
  explainer (next statement, pay-by date, interest-free days for a purchase today), ≈ yearly interest from the
  monthly rate, reward estimate, and a summary before saving. New cards are checked step by step; when editing,
  any step can be opened and saved. The card page's "Edit" buttons open the matching step.
- **Card page** (`#/account/card/:id`): new overview — limit meter (billed / unbilled / available / limit, alert
  marker), billing cycle with "Mark paid" on the latest statement, interest if only the minimum is paid,
  fee-waiver progress, rewards worth and this-cycle estimate, benefit tags. Hero uses the card's colour.
- **Cards page**: card faces in each card's colour (tap to open), usage meter, owed / available / unbilled
  (hidden by default), free days today; summary shows owed now and available across cards.
- **Notifications**: "N% of the limit used / Over the limit" reminder once a card crosses its alert level
  (again only if usage climbs another 10%).
- **Tests**: `card.model.spec.ts` (billing cycle incl. month-end clamping, billed/unbilled, refunds vs bill
  payments, opening outstanding, limits, interest, waiver, rewards); rules tests for the new card fields.
- **Deploy**: `firestore:rules` (new card fields are rejected until the new rules are live), then hosting.

## Phase 3 — Bills & recurring payments, single dashboard eye
- **Dashboard: one eye for all balances.** A "Show / Hide balances" button next to the greeting reveals or hides
  total wealth (or the selected account), money owed to you, the month's budget "Left" and every account tile
  together; those amounts no longer have their own eyes. Transactions and income / expense totals are not
  affected. Other pages keep their per-amount eyes (`AmountComponent [toggle]`, `MetricCard [amountToggle]`,
  `PrivacyService.setMany / allVisible`).
- **Plan details** (`models/recurring.model.ts`, all optional so existing bills keep working): fixed or
  variable amount, end condition (never / after N payments for EMIs / on a date), installments paid,
  completed, reminders on/off, auto-debit, notes. Count plans count paid installments (skips don't count) and
  are marked **Completed** instead of advancing past the last one; they stay in a Completed tab for history.
- **Month-end dates are kept.** The schedule keeps the day the bill was set to (31 Jan → 28 Feb → 31 Mar)
  through edits, previews and payments. Before, an edit reset it and bills on the 31st drifted to the 28th.
- **Transparent calculations.** The form shows a live "How this plan works" panel: plain-words schedule,
  monthly average, yearly cost, due this month, remaining payments / total and the last date, EMI progress
  and the next six due dates — computed with the same functions the app pays with (`planSummary`).
- **Confirm before important updates.** Editing shows "Confirm changes" (what changes, incl. the monthly
  effect of an amount change, and the plan after saving) before anything is written; Undo restores the
  previous values exactly (fields the edit added are removed).
- **Mark paid** opens a dialog: actual amount (for variable bills), paid-on date (not in the future),
  paid-from account, and "What happens" — the expense, the account balance before → after, and the next due
  date or that the plan completes.
- **Totals count every due date.** "Due in 30 days" counts each weekly / daily occurrence (it counted one),
  plus overdue; new "Left to pay this month" metric. Dashboard commitments use the same logic and skip
  completed plans.
- **Reminder preferences**: on the day / 1 / 3 / 7 days before, or Off — respected by the bell and by the
  09:00 IST push digest (`functions/src/reminders.ts`), which also skips completed plans.
- **Custom controls** throughout the form (frequency tiles, segments, themed date and select pickers).
- **Tests**: `recurring.model.spec.ts` (anchor day, end conditions, occurrences in a window, plan summary,
  change list), privacy group spec, functions test for muted / completed bills.
- **Deploy**: functions (reminder digest), then hosting. No rules change (`upcoming_payments` already accepts
  the new optional fields).
