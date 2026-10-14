# Wyndos handover

Round management for window cleaners (wyndos.io). Owner: Tom. Keep replies to Tom short and plain.

## Roadmap
- Agreed-but-not-built work lives in `docs/ROADMAP.md` (refunds first). Check it when planning.

## Stack
- Next.js 16 (app router, server actions), React, Tailwind 4, Prisma 7.
- SQLite locally (`demo.db` / `dev.db`), Postgres in production.
- Two schemas kept in step: `prisma/schema.prisma` (SQLite) and `prisma/schema.postgres.prisma`.
- Migrations are hand-written in **both** `prisma/migrations/` and `prisma/migrations-postgres/` with the same folder name.
- After schema changes: `npx prisma generate && npx prisma generate --config prisma.config.postgres.ts`.
- Install deps with `npm install --legacy-peer-deps` (next-auth / nodemailer peer conflict).

## Branches and deploy
- Work is on `feature/whole-day`. Tom merges to `main` and deploys.
- Production: Hostinger VPS, app at `/opt/wyndos/current`, env file `/opt/wyndos/shared/.env.production`, systemd unit `deploy/systemd/wyndos.service`, deploy script `deploy/deploy-vps.sh` (runs `npm ci`, prisma generate, `migrate deploy` on Postgres, build, restart).
- Tom deploys from his local dashboard `_devtools/` (gitignored). `_devtools/config.js` → `appEnv` holds production env vars; each deploy writes them into the VPS env file (re-read on every deploy).
- **Secrets never go in git.** They live only in `_devtools/config.js`.

## Production env vars (names only)
- Auth/app: `AUTH_SECRET`, `NEXTAUTH_URL` / `APP_URL`, `DATABASE_URL`, `CRON_SECRET`, `SUPER_ADMIN_EMAIL`.
- Email (Brevo SMTP): `PLATFORM_SMTP_HOST/PORT/USER/PASS/FROM_NAME/FROM_EMAIL`.
- Support: `SUPPORT_EMAIL` (support@wyndos.io), `SUPPORT_COPY_EMAIL` or `SUPPORT_BCC_EMAIL` (Tom's BCC copy).
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional `STRIPE_PRICE_ID` (£9.99 intro), `STRIPE_PRICE_ID_STANDARD` (£14.99), `STRIPE_TAX_CODE`.
- Price: `INTRO_OFFER_ENDS=YYYY-MM-DD` closes the £9.99-for-life offer (unset = open). Businesses created on or before it pay £9.99 for life, later ones £14.99. See `src/lib/pricing.ts`.
- AI (optional): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
- Texts: `MESSAGING_LIVE` (server-sent SMS is switched off, see Feature flags).
- Legal pages (build-time, so redeploy after changing): `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_ADDRESS`, `NEXT_PUBLIC_ICO_NUMBER`, `NEXT_PUBLIC_HOSTING_LOCATION`.

## How scheduling works (the core idea)
- Customers belong to an **Area**; you schedule the area, not single jobs. `scheduleAreaRun` puts an area on a date as a `WorkDay` with a `Job` per due customer.
- Area cadence: `frequencyWeeks` or `MONTHLY` + `monthlyDay` (`nextRunAfter`).
- **Due window** (`runDueWindow`): a run includes customers due up to N days after its date (area setting, else business setting, else half the frequency, min 3).
- Completing a day (`completeDay` → `syncAreaScheduleAfterCompletion` / `markCustomersCleaned`) sets last cleaned / next due and books the next run.
- **Split runs**: `WorkDay.partOfId` marks extra parts of one run on other dates (`runPieces`, `moveJobsToDate`). The next visit is booked only when every part is done.
- `autoAddToScheduledDays` adds a new/moved customer to the area's next open run.
- Import (`bulkImportCustomers`): Last Cleaned / Next Due set customer dates; optional `bookRuns` books each area's next run. No history is created.

## Main features and where they live
- Scheduler: `src/app/scheduler/` (drag areas onto days, area search). Day view: `src/app/days/[id]/` (phone-first; "More" sheet).
- Customers + import: `src/app/customers/`. Payments: `src/app/payments/`. Accounting: `src/app/accounting/` (UK tax year; "Before Wyndos" opening figures).
- Texts: `src/app/messages/` + `src/lib/text-actions.ts`, `src/lib/texts.ts`. Texts go from the user's phone (`sms:` links, logged as `MessageLog`).
- Invoices: `src/app/api/invoice/pdf/route.ts` + `src/lib/invoice-pdf.tsx` (VAT invoices, payment terms, mark as invoiced: `Job.invoicedAt/invoiceNumber`). Invoice numbers lock once used (`TenantSettings.invoiceNumbersStarted`).
- Notifications: `src/lib/notifications.ts` (1-minute delayed emails: day started/completed, work assigned), settings at `/account`. Cron backstop `/api/cron/notifications`.
- Support form: `/support` → `src/app/api/support/route.ts` (attachments ≤ 9 MB; nginx limit 10 MB).
- Onboarding: `src/app/auth/onboarding/` (3 steps; `Tenant.signupInfo`); welcome + "new sign-up" emails.
- Backups: Settings → Data. `src/lib/backup.ts`, `/api/backup` (download .json.gz), `/api/backup/restore` (same business only, original ids).
- Close account: Settings → Account. `src/lib/close-account.ts` (cancels Stripe, deletes the business).
- Admin console `/admin` (SUPER_ADMIN), tabs: Overview, Support (tickets from `/support`, stored as `SupportTicket`; replies emailed from `SUPPORT_FROM_EMAIL` or `SUPPORT_EMAIL`, `src/lib/admin-tickets.ts`), Businesses, Access log (end sessions; they auto-close after 2h and are checked against the log), Billing.
- A super admin who has a membership (their own business) opens it from the admin console as themselves, no support session (`/api/admin/own-business`, `superAdminOwnMembership`).

## Credit (paid in advance / paid extra)
- No balance column: credit = the part of a payment not allocated to any job (`Payment.amount` minus its allocations).
- `applyCredit` (actions.ts) pays unpaid completed cleans oldest-first; runs on `completeJob`, on payments with `extra`, and when a job's price drops (`releaseOverpaid`).
- Undo (re-open) a job is a roll-back: a payment taken when it was ticked is voided whole; earlier credit used on it goes back to credit. `completedByUserId` is kept.
- Setting `TenantSettings.keepWorkerOnNextRun` (default on): completing a run gives the next run to the same worker; off leaves it unassigned (`syncAreaScheduleAfterCompletion`).
- Setting `TenantSettings.allowCustomerCredit` (default on): when off, no new credit (overpay / Add credit refused); existing credit still used.
- Day sheet pay forms take "Amount received": short leaves the rest owing, extra becomes credit.

## Cash handover
- A worker's CASH payments (`collectedByUserId`) stay "with them" until the owner records a `CashHandover` (`Payment.handoverId`). `src/lib/cash-actions.ts`, page `/payments/cash`, to-do item for the owner, worker dashboard "Cash to hand over". Owner's own cash isn't tracked.
- Day sheet shows "Cash to collect" (pending cash / no-preference customers, less credit).

## Offline
- Own service worker `public/sw.js` (next-pwa removed). Pages network-first then cached; `/_next/static` cache-first; RSC/API/POST never cached. `public/offline.html` fallback.
- `OfflineStatus` registers it and pre-saves day pages (and work sheets) from yesterday to two weeks ahead (`/api/work-days` returns that range), plus any day or customer page opened by tapping through the app (client navigations aren't full loads, so the worker is asked to fetch them). Sign-out clears saved pages.
- Taps (done, skip, pay, note, price) queue in `src/lib/offline-queue.ts`; calls give up after 12s on weak signal and queue.
- Queue lives in IndexedDB (`wyndos-offline`: stores `queue`, `problems`), with `navigator.storage.persist()`; falls back to localStorage. Old localStorage queues are moved across on load.
- Sent to the fixed route `POST /api/offline/sync` (not server actions, whose names change every deploy). Per item: ok / rejected (→ "Needs checking" list with Try again / Remove) / retry (signed out, database busy). Payments use the item id as clientRequestId, paidAt = when tapped.
- Senders: the page (on load, focus, online, every 10s while waiting) and the service worker (`sync` event on Android, or `{type:"send-offline"}` message). One at a time via Web Locks. `public/sw.js` duplicates the sending code: keep it in step with `offline-queue.ts`.
- A tap online on a page from before a deploy (server action not found) is queued and sent through the route. While older taps are waiting, new taps go behind them.
- Sign-out with unsent changes asks first; going ahead deletes them (so they can't be sent as the next person).
- Browser test: `scripts/sim/offline-browser-check.cjs` (local demo data: sam@example.com, work day 177).

## Billing (Stripe)
- £9.99/month, everything included, no VAT (Tom isn't VAT registered). 15-day trial kept by Wyndos (from `Tenant.createdAt`, or `trialEndsAt`), no card.
- `src/lib/billing.ts`: price by lookup key `wyndos_monthly_gbp` (created on first checkout, tax code `txcd_10103001` for Managed Payments), Checkout with `trial_end` during the trial, customer portal, `applySubscription` / `syncCustomer`.
- Routes: `/api/stripe/checkout`, `/api/stripe/portal`, `/api/stripe/webhook` (signature checked; events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed). `/billing` page syncs on return from Checkout.
- Gate: in `src/app/layout.tsx`. When the trial/subscription has ended only `/scheduler` and `/days` are locked. Owners see a trial bar. Workers are covered by the business's subscription.
- `Tenant.billingExempt` = free forever (all pre-billing businesses were set exempt by the migration).
- Stripe is in **test mode**. The webhook is set up in Stripe Workbench → Webhooks.

## Bank statement matching
- `/payments/import` (button "Bank statement" on Payments). `src/lib/bank-import/parse.ts` (read CSV/XLSX in the browser, find header row, detect columns, UK dates/amounts), `match.ts` (suggestions: saved reference, address first line incl. bank-truncated "68 RIDDEL", Wyndos ref, name/surname, amount fits what's owed).
- **The file never leaves the browser.** Only rows the user ticks are sent (`commitBankImport` in actions.ts). Nothing is ever auto-saved: every row needs a tick. Changing the customer or jobs un-ticks the row.
- `ImportedLine` keeps only a SHA-256 of each handled line (dedupe across overlapping statements). `PaymentImport` = one batch, Undo voids its payments and frees its lines.
- `PayerReference` = learned references (on confirm, if "Remember" is ticked). Shown on the customer page, removable. Only ever a suggestion.
- Payments are recorded as BACS, dated the bank date, note `Bank: <statement text>`, allocated to the ticked jobs oldest first; the rest is credit (refused if credit is off).

## Legal
- `/terms`, `/privacy`, `/cookies` (open signed in or out). Text constants + sub-processor list in `src/lib/legal.ts`.
- Owners tick two boxes at onboarding (terms + "I have the right to store and use my customers' details"). Stored on `Tenant.termsVersion/termsAcceptedAt/termsAcceptedByUserId/dataPermissionAcceptedAt`.
- Layout shows `LegalAcceptGate` to owners until the current `TERMS_VERSION` is accepted (workers aren't blocked). Bump `TERMS_VERSION` to ask everyone again.
- Data protection to-do list: `docs/DATA_PROTECTION.md`.

## Sort into areas (`/customers/organise`, owner only)
- `src/lib/area-planner.ts`. Questions (all optional): working days, customers or £ per day, days early (saved as each new area's `dueWindowDays`), free notes.
- Quick sort (no AI): postcode sector + street, packed to the day's capacity, frequencies kept apart.
- AI sort only when `ANTHROPIC_API_KEY` is set. Model `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), optional `ANTHROPIC_BASE_URL`. Sends street/town/postcode/price/frequency/due only, numbered (no names, house numbers, contacts). Result is checked: each customer once, missing ones go in "Check these". Nothing is saved until the owner presses Save.
- Save makes areas (or reuses same-name ones), moves customers with `bulkMoveCustomersToArea`, removes old areas left empty with nothing booked. Anthropic is listed as a sub-processor in `src/lib/legal.ts`.

## Guided import (`/customers/import/guided`, owner only, needs `ANTHROPIC_API_KEY`)
- An alternative to the normal import (linked from it). Reads the sheet in the browser; `aiReadSheet` sends only headings, the first 5 rows and the distinct values of short columns to work out columns, date order, frequency and payment wording.
- Owner checks/changes the column mapping, fills defaults for missing price/frequency, then keeps the sheet's areas or answers the planner questions (`planRows`, quick or AI). Mixed frequencies in an area become "<area> N weekly". Import goes through `bulkImportCustomers` (`importWithPlan`).

## Page gate
- The `x-wyndos-path` header from middleware never reaches the layout, so the terms screen, trial-ended lock, trial bar and email bar are now decided in the browser by `src/components/page-gate.tsx` (usePathname). Legal pages and /support always open.

## Bank statement import (security)
- The file never leaves the browser: CSV is read in the page, spreadsheets in a throwaway Web Worker (`src/lib/bank-import/sheet.worker.ts`, bytes transferred then the worker is ended). Only the rows the user ticks are sent (date, amount, up to 140 chars of text). Nothing goes in browser storage.
- File input is cleared straight after reading; everything is forgotten on save, on leaving the page and on `pagehide`. `/payments/import` is `Cache-Control: no-store` and skipped by the service worker.
- Server keeps only: the payment (notes "Bank: <text>"), a one-way hash per line (`ImportedLine`) to skip repeats, and learned references (≤60 chars) when the user ticks "remember".
- To-do: `xlsx` 0.18.5 from npm has known issues (fixed in SheetJS 0.20.x, only on cdn.sheetjs.com). Risk is low (runs in the worker on the user's own file). Upgrade with `npm i --legacy-peer-deps https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.

## Staging and backups
- Staging: `deploy/STAGING.md` (`/opt/wyndos-staging`, port 3001, `sudo ./deploy/deploy-vps.sh --staging`).
- Hourly encrypted off-site DB backups: `deploy/BACKUPS.md` (`deploy/backup/wyndos-backup.sh`, systemd timer, monthly `wyndos-restore-test.sh`).

## Feature flags
`src/lib/features.ts`: `AUTO_SMS_ENABLED = false` (VoodooSMS etc. hidden; phone only), `INVOICE_EMAIL_ENABLED = false`, `GOCARDLESS_ENABLED = false` (settings, sync button, customer GoCardless fields hidden until stage two).

## Testing locally
- `NODE_ENV=production npx next build && npx next start -H 127.0.0.1 -p 3000` against SQLite (`DATABASE_URL=file:./demo.db`).
- Demo logins on the demo DB: owner@demo.test / DemoPass123!, jake@demo.test / JakePass123!.
- UI checks were done with Playwright (Chromium) at desktop and iPhone sizes. Email checked with a local fake SMTP server.
- `npx tsc --noEmit -p .` before committing.

## Open items / next steps
- Billing is enforced in the layout only; server actions don't check it yet.
- Roll the Stripe test keys (they were shared in chat) and switch to live keys + live webhook when ready.
- Check phone texting (`sms:` links, auto-advance) on a real iPhone and Android.
- Invoice emailing and server-sent SMS are built but switched off (feature flags).
- Possible: Capacitor/Play Store wrapper, push notifications.

## Phone scheduler
- `/scheduler` on phones (under md) shows `src/app/scheduler/mobile-scheduler.tsx` instead of "desktop only". Note at top points to a bigger screen for drag and drop.
- Booked runs (unfinished from last 4 weeks + next 8 weeks): move date, change worker (owner), open day. A started day with jobs done moves only the jobs left (`moveJobsToDate`); otherwise `rescheduleWorkDay(..., "one-off")` like desktop.
- Needs booking: areas with customers and no open run; pick date (and worker) → `scheduleAreaRun`.
- Calendar tab (default): month grid with a coloured bar per run (faded = done, red date = unfinished, amber = holiday). Tap a day to see its runs (same move/worker/open controls) and book an unbooked area onto it. `getMobileMonth("YYYY-MM")` loads 6 weeks.
- Data: `getMobileSchedule()` in `src/lib/mobile-schedule.ts`. Scheduler now shows in the phone "More" menu.

## Getting started guide
- `/guide` (open to everyone, like /terms): `src/app/guide/page.tsx`, linked from Help & support, the desktop sidebar and the phone + menu.
- Screenshots in `public/screens/guide/*.webp`, from a made-up business. To refresh after UI changes:
  `DATABASE_URL=… npx tsx scripts/seed-guide-demo.ts` → run the app → `node scripts/guide-screenshots.mjs` → `python3 scripts/guide-compress.py`.
  Demo logins: sam@example.com / jamie@example.com, password GuideDemo123! (local/staging only, never production).
- Landing page screenshots (`public/screens/*.jpg`) come from the same demo business: `node scripts/landing-screenshots.mjs` then `python3 scripts/landing-compress.py`. Run the app with TZ=UTC so server and browser agree on today.

## CleanerPlanner import
- `/customers/import/cleanerplanner` (owner only), linked from the import page. Upload the CleanerPlanner backup zip (or its CSVs); read in the browser (`src/lib/cleanerplanner/parse.ts`, fflate), never uploaded.
- Each CleanerPlanner job → a Wyndos customer (a second service at the same house is a second customer with its own job name). Round → area; rounds mixing cycles split into "<round> N weekly". Cycle from Due→NextDue gap, else ScheduleInterval/FrequencyId (1 days, 2 weeks, 3 months). StatusId 1 = active. Job's own contact = the property when it has an address.
- Balances: Balance from Jobs.csv; which way round is checked against Transactions (StartingBalance + charges − payments). Without history → "Balance brought forward" clean (owed) or unallocated payment (credit). With history → StartingBalance brought forward, then every charge (TypeId 0) as a clean, then every payment (TypeId 1) paying the oldest cleans first; the rest is credit. Drafts and missed rows skipped.
- Server: `src/lib/cleanerplanner/actions.ts` (chunks of 250 customers / 1500 history rows), linked by ids, skips name+address+job already in Wyndos.
- Payment methods not on Wyndos' list ("Under mat") are kept as a note "Usually pays: …" (also in the normal import); history payments keep "Paid by: …".
- Jobs with no repeat go into the one-off customers area; the summary lets each extra service (e.g. Gutter clear) on a repeat come in as one-offs instead.
- Customers page shows a "One-off (N)" quick filter when there are any (`countOneOffCustomers`).
- `GUIDED_IMPORT_ENABLED = false` in features.ts: guided import hidden everywhere and its page redirects.

## Inactive customers area
- Deleting an area with only inactive customers moves them to a hidden system area "Inactive customers" (`src/lib/system-areas.ts`), keeping history and balance; shown as "No area (inactive)". Areas with active customers still can't be deleted.
- Switching such a customer back on asks for a real area first (Change Area). The one-off area lookup and "one-off" filter ignore this area.

## Removed: "Paid by another customer"
- UI and logic gone (payments, credit, texts, to-do, bank matching). Column `Customer.paidByCustomerId` stays but is unused; migration 20261006120000_clear_paid_by clears existing links.

## To-do: mark as done
- Dashboard to-do rows have a "Done" button (`src/components/todo-list.tsx`, `dismissTodo`). Stored per person in `Membership.notifyPrefs.todoDone` as "key|detail" → hidden until the line changes; entries older than 45 days are pruned. `saveMyNotifyPrefs` now merges instead of overwriting.

## Order of work on a day (Oct 2026)
- One rule everywhere (day view, print, PDF): `src/lib/day-order.ts` — areas by `WorkDay.dayOrder` (per date, else Area.sortOrder), jobs by `Job.sortOrder`, then links.
- Links: `Job.afterJobId` (today only: job id, 0 = first, -1 = ignore the customer's link) and `Customer.placeAfterCustomerId` (always, when both are on the date). A link to someone not on the date is ignored.
- Saving: `src/lib/day-order-actions.ts`. Day view "Reorder": drag/arrows anywhere, area arrows, "Sort each area by street", "Back to normal order"; after a move it offers "Always" / "Change it" (needs Areas permission).
- Added or moved jobs go to the end of their area (`endOfDay`); customers moved to another area go to the end of it (`endOfArea`).
- The old "All jobs by street" view is gone (street is now a one-off sort you can then tidy).
- Scheduler month cell: clicking the date or empty space opens /days/date/[date].

## Zero-downtime deploys (Oct 2026)
- `deploy/deploy-vps.sh`: `/opt/wyndos/current` is only the git checkout. Each deploy copies it to `/opt/wyndos/releases/<time>-<sha>`, installs/migrates/builds there while the old one serves, then points `/opt/wyndos/live` at it and restarts `wyndos@3002` then `wyndos@3000`, each only after the other is healthy (rolls back the symlink if not). Keeps 3 releases.
- systemd template `deploy/systemd/wyndos@.service` (installed by the deploy script). The old single `wyndos.service` is disabled on the first new deploy.
- nginx: upstream `wyndos_app` (3000 + 3002) with `proxy_next_upstream`; `/_next/static` served from `/opt/wyndos/shared/next-static` (every build's files, 30 days). One-off: `sudo ./deploy/setup-zero-downtime.sh`.
- App: `next.config.ts` `deploymentId` from `.release-meta.json` (skew protection: old pages do a full load on navigation); `/api/version` + `UpdateBanner` show "Wyndos has been updated · Refresh".
- Dashboard: its service status check should use `wyndos@3000`.

## Smart import (AI)
- `/customers/import/smart` (owner only). Upload any file → Wyndos export read directly; CleanerPlanner zip → its importer; Wyndos backup → Settings.
- Anything else: AI sees headings + ~16 sample rows (emails/phones masked) and returns a *plan* (which column is which). Code applies the plan to every row in the browser → preview → `bulkImportCustomers` (skip existing, match name+address).
- "Not quite" = owner feedback (500 chars, max 4 tries) used only to change the reading plan; off-topic requests are refused and the plan stays the same. 25 AI calls per business per day.
- Several files (or sheets of one workbook) at once, up to 4: each gets its own plan (customers or job history). Customers save first, then quotes, then history, then runs are booked.
- History rows are matched to customers by the other program's ref (from the customer file in the same upload), then address first line + postcode, then name if unique. Unmatched rows are left out and listed. Cleans already recorded on the same date are skipped.
- "Ask Wyndos to import it" sends the file(s) to support.
- Needs `ANTHROPIC_API_KEY` in appEnv. Optional `ANTHROPIC_IMPORT_MODEL` (default `claude-opus-5-5`). Flag: `SMART_IMPORT_ENABLED` in `src/lib/features.ts`.

## GoCardless (Direct Debit)
- Pasted read-write access token (Settings → Business), no webhooks: sync via "Sync now", or every 15 min if the server crontab has `/api/cron/gocardless` (CRON_SECRET; line in deploy/GOCARDLESS-TESTING.md). The deploy script doesn't install it; Tom is keeping it manual for now. Same `syncTenant` either way.
- `src/lib/gocardless/core.ts` (server only, takes tenantId), `actions.ts` (owner-only wrappers). Page: `/payments/direct-debit`.
- One GoCardless payment per completed clean (Job.goCardlessPaymentId/Status), Idempotency-Key `wyndos-t{tenant}-job{id}-{previous id|first}`.
- Received → Payment (BACS, "Direct Debit (GoCardless)") allocated to the clean. Failed/cancelled → clean owes again. Charged back → payment voided.
- Sign-up links = billing request + flow; fulfilled request links the mandate on next sync. Public return page `/direct-debit-done`.
- Auto-collect only for cleans completed after it was switched on; failed ones are never auto-retried.
- On only with `NEXT_PUBLIC_GOCARDLESS_ENABLED=1` at build. Testing steps: `deploy/GOCARDLESS-TESTING.md`. `GOCARDLESS_API_BASE` overrides the API host (tests).

## Expense import + HMRC categories
- Expense categories map to HMRC MTD periodExpenses fields (`HMRC_EXPENSE_CATEGORIES` in `src/lib/accounting.ts`); migration `20261008130000_hmrc_mtd_categories` recomputes `Expense.hmrcCategory`.
- `/accounting/import` (owner): bank/card statement, receipts sheet or template (`public/templates/expense-import-template.csv`, read without AI). AI reads layout + categorises supplier names (merchant keys); rules fallback; preview with per-supplier category changes; transfers/tax/personal left out but can be included; duplicates (date+supplier+amount) skipped.
- Smart job history: `/customers/import/smart?mode=history`.
- Every import shows "Not imported" rows with reasons (`src/components/not-imported-list.tsx`), in the preview where known and after saving, with CSV download.

## Making Tax Digital (accounts)
- `/accounting/mtd` (accounting permission; settings + submit/unlock owner only). Quarters (standard 6 Apr or calendar), per-quarter and cumulative figures per HMRC SE Business API field (+ …Disallowable), consolidated option under £90k, year summary, capital allowances.
- Calculations: `src/lib/mtd/calc.ts` (pure, tested): cash/accruals turnover, VAT-registered → net figures, business-use % → disallowable, entertainment/depreciation always disallowable, mileage-rate vehicles make their fuel/repairs/tax/insurance disallowable (parking ok), mileage 45p (55p from 2026/27) first 10k then 25p, motorbike 24p, use of home £10/£18/£26, assets (cash basis: equipment/vans expensed, sale = income; accruals: AIA; cars 100%/18%/6% WDA, private use single pool).
- Data: `Vehicle`, `MileageTrip`, `HomeUseMonth`, `BusinessAsset`, `MtdQuarterLock` (+ Expense.businessPct/vehicleId, TenantSettings.accountingBasis/mtdPeriodType). In backups, account close and clear-all.
- Submitted quarters block adding/editing/deleting expenses, other income, trips, home hours and assets dated in them; changes from payments show "changed since submitted".
- Export: Excel for bridging software (About, Cumulative, By quarter, Year end, Transactions, Mileage, Use of home, Assets).
- Production hides thrown server-action messages (React #441): MTD actions return `{ ok, error }`; accounting forms pre-check `lockedReason`.

## Import editing, defaults, history matching
- Smart import (customers/history) and expense import: "Change columns or defaults" (`src/components/column-mapper.tsx`) edits the plan without AI: columns per field, heading row, file kind, and a value used when a cell is blank (`plan.defaults`).
- Any preview row can be edited or left out (customers: name, address, area, price, frequency, next due, phone, email, notes, active; history: date, price, paid; expenses: date, supplier, amount, VAT). Left-out rows show in "won't be imported" and can be put back.
- History that doesn't match: grouped per person; choose a customer (existing or new in the upload), "former customer" (created inactive in the Inactive customers area with their history), or leave out.
- `CustomerAlias` (REF / ADDRESS / NAME): saved when the owner matches by hand ("remember for next time") and for every reference in an imported customer file; matching uses them. In backups.

## Smart import: "try again" that listens (new72)
- AI now sees `<current_preview>` (first rows as the last plan read them) and the feedback rule says do every import-related change the owner asks for.
- Plans have `fixedValues` (every row) as well as `defaults` (when blank); both survive retries. Mapper shows "Every row: X" with a clear button.
- After a retry the page lists exactly what changed, or says nothing did and points to Change columns. Same for expenses (category moves, left out / put back).
- Messy files: "£12 cash" style prices (full text kept in notes), "Phone / Email" columns split, frequency read from notes ("8 Weekly - Due Dec"), Paid/Unpaid not treated as a payment method, and every sheet of a multi-sheet workbook gets a Sheet column used as the area.

## Customer feedback round (new73)
- Bank matching: "Old customer (not in Wyndos)" saves the line as Other income, category PAST_CUSTOMER (counts as turnover in MTD). `ImportedLine.otherIncomeId`; undo deletes it. Migration `20261010120000_bank_line_income`.
- Skip: next due = area's next run from max(planned day, today); finishing a day sets skipped customers to the area's next run. Fixes "skipped shows overdue".
- Invoice logo: `lib/logo-image.ts` flattens onto white with sharp (see-through PNGs went black in react-pdf). PDF building moved to `lib/invoice-build.ts`.
- Phones: Areas, bulk edit, pop-ups and the quick-add menu use dvh (100vh hid the bottom under the browser bar).
- Trial features: `Tenant.trialFeatures` (comma list), switched per business in Admin → Billing. On a local `npm run dev` copy, or a server started with `WYNDOS_SANDBOX=1` (sandbox/demo only, never live), every trial feature is on for every business (`ALL_TRIALS_ON`). First one `auto_invoice`: Settings toggle `autoInvoiceEmail` shows only when trialled; finishing a day emails an invoice (PDF) for unpaid cleans to customers with an email, via platform SMTP, reply-to the business. Each clean invoiced once; failures logged (MessageLog kind INVOICE_EMAIL) and un-marked. Migration `20261010140000_trial_features`.
- Owing: amber "£X owed to you" line on the dashboard → /payments?tab=owing.
- Accounting: "Sales v money in" (cleans done v payments) and per-month line.
- Smart import: sheets with mostly matching headings are merged into one list (union of headings + Sheet); AI gets per-column fill counts. "Try again" defaults to all parts. Customers on a different frequency from their round go in "<round> N weekly" (round names that state a frequency use it).

## Aworka import + smart import upgrades (new74)
- `/customers/import/aworka`: reads an Aworka full export in the browser (`lib/aworka/parse.ts`) into the CleanerPlanner plan, so it shares the screen (`MoveImport source=…`) and server actions. jobs.csv → customers (rounds split by frequency; On Request / One Off → one-offs; Suspended/Deleted/Transferred → inactive; Estimates listed as not imported; repeated jobs kept once, live one preferred). Balances are per customer, put on the main job; Aworka negative = owes. activity-*.csv → cleans, payments (on clean / invoice / own; repeated "payment" rows skipped), tips (negative Tip/Bad Debt on a paid clean → Other income BONUS), bad debts (write-off: lowers the oldest unpaid cleans' price). Checked on a real export: 563/564 balances rebuild exactly. expenses.csv → expenses via `importExpenses`, category per Aworka category (editable), loan repayments left out by default.
- CleanerPlanner history fix: payments in the same batch as new cleans now pay them (previously could become credit).
- Smart import: optional notes before reading (`hints` → `<owner_instructions>`), with quick chips; new-area panel (rename/join existing, colour, frequency); Edit button per row + Issues column; existing customers skip/fill/overwrite; same address more than once → extra one-off jobs (One-Off area, "Extra job") / separate customers / same customer twice (left out). `bulkImportCustomers` gets `matchJob` (name+address+job).

## GoCardless per business (new75)
- Switched on per business: Admin → Billing → "Trial: GoCardless" (`Tenant.trialFeatures` contains `gocardless`), or server-wide with the build flag. `goCardlessOn(tenantId)` in `lib/trial-features.ts` gates actions, the Direct Debit page, the cron, Settings (card and saving the token), Payments buttons and the customer page.
- Customer page: Direct Debit panel (status, mandate, "Get sign-up link" with copy) for owners when switched on and a token is saved.
- Money safety (Direct Debit): collections keyed per tick (`tick-<completedAt>`) or per failed payment (`after-<id>`); payment saved onto the clean only if it's still the same tick, else cancelled; undo re-checks after saving. Try again only for failed/cancelled (not charged back / refused); refused if GoCardless is retrying the old one. Sync: one per business at a time (in-process), checks failed payments too (late success, reversed charge-back), records money for deleted cleans as credit, never records twice. Credit never pays a clean with a collection in flight; paying a clean another way cancels its pending collection. Plan (subscription) checked at collect time, belongs to the payer of a shared Direct Debit. Refund keys include an attempt count; a refund whose answer was lost is picked up, not repeated. Test: `scripts/sim/gc-money-check.ts` (90 checks, needs `gc-mock.cjs`); sandbox run sheet: `docs/GOCARDLESS-SANDBOX-CHECKLIST.md`.
- Shared Direct Debit: several customers can hold the same mandate id (`shareDirectDebit` copies mandate/status/CU id; `stopUsingDirectDebit` clears). Cleans are still collected per customer, with the address in the payment description. Mandate status updates and replacements apply to everyone sharing. Outside payments (step 3b) pay oldest unpaid cleans across all sharers; leftover credit goes to the earliest-linked customer (the payer). Tests: `scripts/sim/shared-dd-check.ts` (needs `gc-mock.cjs` on :4600).
- Testing steps: `deploy/GOCARDLESS-TESTING.md`.

## Invoice emails per customer + import credit fix (new78)
- `Customer.emailInvoices` (migration `20261012090000_customer_email_invoices`): ticked on the customer's details; set automatically on import when "Usually pays" is Invoice and there's an email.
- Customer page → Invoice → **Send email** (businesses with Admin trial "Invoice emails", key `auto_invoice`): `/api/invoice/email` → `lib/invoice-email.ts` (`emailInvoice`, shared with the day-end auto invoices, which now only go to customers with emailInvoices).
- CleanerPlanner/Aworka import: credit brought across now pays the history's unpaid cleans at the end (`useCreditOnUnpaid`). Payments → Credit offers "Use their credit" for anyone with credit and unpaid cleans (fixes earlier imports, e.g. HQ Dental).

## Complete Day choices + invoice email delay (new80)
- Complete Day: each unfinished job has Carry over / Skip buttons, plus Carry over all / Skip all (was tick = carry, untick = skip).
- Auto invoice emails now go through a queue (`lib/invoice-queue.ts`): a clean is emailed once its day is finished and `autoInvoiceDelayMinutes` has passed (Settings: wait N minutes/hours/days). Only cleans done since `autoInvoiceSince` (set when switched on), still unpaid, customer has Email invoices. Failed sends wait 6 hours before retrying. Timer after finishing a day + cron backstop:
  `5,20,35,50 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/invoices`
  Migration `20261012110000_invoice_email_delay`.
- Invoice emails are sent ONLY from the business's own email account (Settings → Email, `lib/tenant-email.ts`), never Brevo/platform SMTP. The Email settings tab is shown to businesses with the invoice-email trial. Without it set up: customer button says "Set up your email", queue skips the business.

## Consistency tests (scripts/sim)
- Dev tool, test database only (creates businesses). Runs the real server actions with a fake login and clock.
- `DATABASE_URL=... AUTH_SECRET=x TZ=UTC npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/scenarios.ts` → 18 targeted tests (all pass).
- `SEED=1 DAYS=120 ... scripts/sim/run.ts` → random 120-day business; after every action checks the rules in `scripts/sim/lib.ts` (area has one run, nobody missed/twice, money in = paid cleans + credit, etc.) and reports the first action that broke each rule.
- Rules to keep: a done clean is never deleted/repriced/moved; money only sits on done cleans; a part of a run (house moved to another date) never books or deletes the area's next run; re-dating or finishing an old day never winds back a customer cleaned since.
- Known and accepted: moving a customer into an area with a different cycle means they wait for (or are early for) that area's next run; carrying every house off a day leaves the day empty until it's finished.

## MTD and expenses (Oct 2026)
- Wyndos keeps the digital records and works out HMRC's quarterly boxes; it does **not** send to HMRC (export → bridging software), do the final declaration or work out tax. The MTD page says so.
- Repeat expenses/income: `src/lib/recurring.ts` `materialiseRecurring(tenantId)` runs when Accounting, MTD, month view or exports load (no cron). The entry is the first one; copies catch up from its date, capped at 400 per run. "Stop repeating" on each row.
- Locks (marked as submitted): expenses, other income, mileage, use of home, assets, opening figures, settings (basis/quarters) and, on cash basis, customer payments (void/restore/date change/backdated payment).
- Use of home months count mid-month (April is in the new tax year). Payment dates are UK dates (BST).
- Vehicles: can't switch method once trips or linked costs exist. MTD shows "Worth checking" for unlinked fuel while a vehicle is on mileage, and car/van assets alongside a mileage vehicle.
- Capital allowances: main pool 18% to 2025/26, 14% from 2026/27; special 6%; zero-emission FYA to 5 Apr 2027. Pooled car sales come off the pool (no balancing allowance); single asset pool settles on sale.
- `broughtForward` on Payment/Job: balances/credit carried over from another program are never income.
- Checks: `scripts/sim/mtd-calc-check.ts` (pure sums) and `scripts/sim/mtd-actions-check.ts` (actions, needs DB).
- Known limits: no VAT registration date/Flat Rate Scheme; refunds (roadmap); calendar quarters 1–5 April edge; balancing charge on AIA items sold uses sale price × business %.

## GoCardless Connect (OAuth, Oct 2026)
- Wyndos is a GoCardless partner app. Env (server only, never git): `GOCARDLESS_CLIENT_ID`, `GOCARDLESS_CLIENT_SECRET`, `GOCARDLESS_OAUTH_ENV` (sandbox | live), optional `GOCARDLESS_REDIRECT_URI`. Site address from `APP_URL`/`NEXTAUTH_URL`.
- Redirect URL to register in the GoCardless app (exact): `<site>/api/gocardless/oauth/callback`.
- Settings → Business → GoCardless: "Connect GoCardless" (`/api/gocardless/oauth/start` → GoCardless → `/api/gocardless/oauth/callback`, state cookie checked), Disconnect revokes the token. Pasting a token still works (under "Or paste an access token").
- `TenantSettings.goCardlessOrganisationId` (migration `20261013140000_gc_oauth`) = connected via OAuth; needed later for partner webhooks (`links.organisation`).
- Webhooks: `POST /api/gocardless/webhook` (open in middleware; checks `Webhook-Signature` HMAC with env `GOCARDLESS_WEBHOOK_SECRET`, 498 if wrong). Events are matched to a business by `links.organisation` → that business is synced 5 s later (payment_confirmed, failures, charge-backs, mandates, sign-ups). `organisations/disconnected` forgets the token. Webhook URL to set in the GoCardless app: `<site>/api/gocardless/webhook`. Only for businesses connected with Connect (pasted tokens have no organisation ID).
- Settings shows the GoCardless account name and verification (successful / in_review / action_required) from `/creditors`. Connect has "Connect my GoCardless account" (login) and "Create a GoCardless account" (`?signup=1` → initial_view=signup).

## Refunds (Oct 2026)
- A refund is a Payment with a negative amount, `refundOfId` = the payment refunded, dated the day the money went back (`src/lib/refunds.ts`). Money that was on cleans comes off them as negative allocations (newest first); `refundWriteOff` also lowers the clean's price (not owed), otherwise the clean owes again. Unallocated part comes off credit. Credit refunds: negative payments with no allocations, taken from the newest spare money (`netSpare` in actions.ts keeps applyCredit from spending refunded credit).
- Actions: `getRefundInfo`, `refundPayment` (how: GOCARDLESS | CASH | BACS | CARD), `refundCustomerCredit`. Voiding a refund undoes it (restores prices); GoCardless refunds can't be voided. A payment with a refund can't be voided.
- GoCardless: `createGcRefund` (`POST /refunds`, total_amount_confirmation, idempotency key). Sync step 3d: status updates; cancelled/bounced/funds_returned → undone; dashboard refunds recorded as write-offs.
- UI: customer page payment rows (refund button, refunds shown as "Refund −£"), "Refund credit". Guide section 9 rewritten. Checks: `scripts/sim/refund-check.ts`.
- Partner review answers + demo script: `docs/GOCARDLESS-PARTNER-REVIEW.md`. Guide content is `src/app/guide/direct-debit/guide-content.tsx` (public at /guide/direct-debit; app links only for businesses with Direct Debit on).

## Meta (Facebook) Pixel
- `src/components/meta-pixel.tsx`, pixel 274026224259554. Only for signed-out visitors on public pages (/auth/signin landing, /auth/signup, /guide*, /cookies, /privacy, /terms), only after "Allow" on the consent box (stored in localStorage `wyndos-ads-consent`). Never loads inside the app.
- Events: PageView per public page; CompleteRegistration on sign-up (`trackMeta`). Cookie Policy lists _fbp/_fbc and has "Turn them off / Allow them"; Privacy Policy mentions it.

## Payments export
- Payments → **Export** (`src/app/payments/export-payments.tsx`) → `GET /api/export/payments` (payments permission). Filters: date paid range (presets: last 7 days, this/last month, this/last tax year), how paid (cash / bank / card / Direct Debit), area, taken by, include refunds. Voided and credit-brought-forward rows left out. One row per payment with what it paid for (cleans + credit), total row.
