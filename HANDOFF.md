# Wyndos handover

Round management for window cleaners (wyndos.io). Owner: Tom. Keep replies to Tom short and plain.

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
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional `STRIPE_PRICE_ID`, `STRIPE_TAX_CODE`.
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
- Setting `TenantSettings.allowCustomerCredit` (default on): when off, no new credit (overpay / Add credit refused); existing credit still used.
- Day sheet pay forms take "Amount received": short leaves the rest owing, extra becomes credit.

## Cash handover
- A worker's CASH payments (`collectedByUserId`) stay "with them" until the owner records a `CashHandover` (`Payment.handoverId`). `src/lib/cash-actions.ts`, page `/payments/cash`, to-do item for the owner, worker dashboard "Cash to hand over". Owner's own cash isn't tracked.
- Day sheet shows "Cash to collect" (pending cash / no-preference customers, less credit).

## Offline
- Own service worker `public/sw.js` (next-pwa removed). Pages network-first then cached; `/_next/static` cache-first; RSC/API/POST never cached. `public/offline.html` fallback.
- `OfflineStatus` registers it and pre-saves today's and the next few days' day pages. Sign-out clears saved pages.
- Taps (done, skip, pay, note, price) queue in `src/lib/offline-queue.ts`; calls give up after 12s on weak signal and queue.

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
