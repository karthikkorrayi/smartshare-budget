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

## Phase 4 — Lending & "Split this amount"
- **Lending & splits page** (`#/lending`, in the menu): people with what each owes you / you owe (netted when
  money goes both ways), open records sorted by repay-by date, split bills with who has paid, and settled
  records. Owed to you / You owe are hidden by default; the dashboard's single eye covers both.
- **Split this amount**: switch it on when adding an expense (or tap **Split** on any expense's details, or
  "Split a bill" from the + menu). "Me" is in the split by default; equal shares (paise left over go to you)
  or exact amounts; optional phone numbers and a repay-by date; names you've used before are one tap.
- **No double counting**: a split books **your share** in the expense's category and **each other person's
  share** as a separate "Lent" entry on the same account, each with its own lending record. The account drops
  by exactly what you paid, the category shows only your part, and each repayment comes back as income (as
  before). A panel on the Lending page shows this month's Lent spending, repayment income and the net effect.
- **Record repayment** dialog (replaces the inline box and the one-tap tick): full / half / any amount,
  received-on date, received-into account, "forgive the rest" (closes the record; forgiven money is never
  income), and a "what happens" preview. Partial payments as before.
- **WhatsApp & call**: one tap opens WhatsApp with a ready reminder ("₹600 for Dinner at Paradise (22 Nov) is
  still pending") — per record, per split member, or one message per person covering everything (netted when
  both sides owe). Without a saved number WhatsApp lets you pick the chat. Numbers are stored with the
  country code (10-digit numbers get +91).
- **Lending form** rebuilt with the themed controls: lend from a bank account, wallet **or credit card**
  (the "Lent" entry goes on that account), phone, repay-by date, notes, "what happens" preview; records can
  now be **edited** (name, phone, repay-by, notes; the amount until the first repayment — its Lent entry is
  re-booked).
- **Safe deletes**: deleting a record removes its Lent entry only if nothing was repaid yet; once money has
  come back, both the Lent spending and the repayment income stay (removing one would invent income). A split
  can be deleted as a whole only before anyone pays. Lent entries open "Open in Lending" from their details
  instead of being edited on their own.
- **Dashboard**: lending panel links to the page, has "Split a bill", and its tick opens Record repayment.
  Activity → Lending points to the new page. Lending reminders in the bell open the Lending page.
- **Data** (all optional on `receivables`, no migration): `phone`, `lentKey`, `waivedAmount`, `splitId`,
  `splitTitle`, `splitTotal`, `splitCount`, `splitOwnShare`, `splitOwnKey`; lent `accountType` may now be
  `wallet` or `card`. No rules change (`receivables` already accepts the owner's fields).
- **Tests**: `lending.model.spec.ts` (split maths to the paisa, phone/WhatsApp links, reminders, people,
  splits, stats), `ledger.lending.spec.ts` (what a split books, card splits, rollback on bad shares,
  partial repayment + forgive, borrowed / note-only never touch the budget, safe deletes).
- **Deploy**: hosting only.

## Phase 5 — Financial discipline streaks & push notifications
- **Streaks page** (`#/streaks`, in the menu): three streaks — **logging** (any entry you made that day, or
  "Nothing spent today"), **no-spend** and **within the daily limit** — each with today's status, the best ever,
  and progress to the next milestone (3, 7, 14, 21, 30, 50 … 365). A 12-week calendar (no spend / within /
  over the limit, logged days dotted), badges earned from your best streaks, and one motivational line chosen
  by situation (milestone, evening "your streak needs today", over-limit "fresh start", close to a milestone,
  steady run, getting started) — wording rotates daily, never shaming.
- **"Nothing spent today"** check-in: a quiet day keeps the logging streak (stored on `users/{uid}.checkins`,
  with Undo). Best streaks are kept on `users/{uid}.disciplineBest` so they survive beyond the loaded history.
- Same rules as the budget: card-bill payments, wallet top-ups and repaid loans aren't spending; refunds
  reduce it; days before the account existed never count; a streak broken today shows 0.
- **Real push notifications, configurable** (Profile → Notifications, and on the Streaks page): this device
  on/off, **Send a test notification**, and per-kind switches with an example of each:
  - Morning (choose 6–11 AM, default 9): bills & card dues; streak milestone reached yesterday
    (spending streaks only while you've logged something in the last 3 days — a day you didn't open the app
    looks like a no-spend day).
  - Evening (choose 5–11 PM, default 9 PM): check-in if nothing is logged today (only if you used the app that
    week); Sundays the weekly recap instead (spent vs last week, no-spend days, limit days, logging streak).
  - As it happens: new items to review (unchanged).
- **Cloud Functions**: `dailyDueDigest` now runs every hour (IST) and sends each user's pushes at their
  chosen hours, at most once per kind per day (`users/{uid}.pushLog`, written by functions only). The name is
  kept so the deploy updates it in place. New callable `sendTestPush`. Streak maths in
  `functions/src/discipline.ts` mirrors `src/app/utils/discipline.util.ts` (tests on both sides).
- **Rules**: settings accept `morningHour` (6–11), `eveningHour` (17–23) and push kinds `checkin`, `streaks`,
  `weekly`; `checkins` (≤ 400 days) and `disciplineBest`; clients can't write `pushLog`. Rules tests added.
- Profile's settings form now saves only its own fields (limit, reminder days, streak messages), so it can't
  overwrite notification choices made elsewhere.
- **Deploy**: rules + functions, then hosting.
