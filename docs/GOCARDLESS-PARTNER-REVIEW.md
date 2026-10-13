# GoCardless partner review: answers and demo script

For the go-live checklist (https://docs.gocardless.com/docs/partner-integrations/go-live-checklist).
Record the demo with a second sandbox GoCardless account, acting as a window cleaner using Wyndos.

## Checklist answers

**1. OAuth**
- Sign-in view: Settings → Business → GoCardless → "Connect my GoCardless account" (`initial_view=login`).
- Sign-up view: "Create a GoCardless account" (`initial_view=signup`).
- Pre-filling: business name, email, country (GB).
- Connected status: "Connected to GoCardless: <account name>", with Disconnect (revokes the token).
- Account status: from `/creditors` `verification_status`: Account verified / GoCardless is checking your account / GoCardless needs more details.

**2. Mandates**
- Hosted payment pages (Billing Request Flows). No custom pages.
- Customer details pre-filled (name, email, address).
- Bank details: not pre-filled (Wyndos doesn't hold customers' bank details).

**3. Payments**
- Payments endpoint: one-off payment per completed clean (manual "Collect", or automatic per business).
- Subscriptions: read only (existing plans are recognised so regular cleans aren't charged twice). Not created.
- Instalments, Open Banking, Success+, Protect+, Outbound payments: not implemented.

**4. Refunds**
- Refund button on a payment: full or part, "Back through GoCardless" (`POST /refunds` with `total_amount_confirmation`), or recorded as cash/bank/card.
- Refunds made in the dashboard are picked up; cancelled/bounced refunds are undone in Wyndos.

**5. Reconciliation**
- Mandate status: customer page (Direct Debit section) and Payments → Direct Debit.
- Payment status: the clean (In progress / Failed), Payments → Direct Debit, customer payments.
- `payment_confirmed`: webhook → Wyndos syncs that merchant and records the payment as received (statuses confirmed / paid_out).
- Also handled: failed, charged back (payment undone, clean owes again), mandate cancelled/replaced, organisation disconnected.

## Demo video script (about 6 minutes)

1. Settings → GoCardless: show both buttons. Press "Create a GoCardless account" (sign-up view, pre-filled), back out, then "Connect my GoCardless account" (sign-in view) → Allow → back in Wyndos: Connected, account name, verification status.
2. A customer → Direct Debit → Get sign-up link → open it: GoCardless hosted page with name/email/address pre-filled → complete with sandbox bank details.
3. Back in Wyndos: the webhook arrives, the mandate shows Being set up / Active (Payments → Direct Debit).
4. Tick a clean Done → Payments → Direct Debit → To collect → Collect. Show the payment in GoCardless.
5. In the sandbox, move the payment to confirmed (or use the scenario simulator) → webhook → the clean shows paid in Wyndos.
6. Simulate a failed payment → shows under Failed, clean still owes, Try again.
7. Refund: customer → Payments → refund button → Back through GoCardless → write off → shows "Refund −£…"; show it in GoCardless.
8. Settings → Disconnect.

## Still to do before submitting
- Live GoCardless account and live partner app (redirect URL `https://wyndos.io/api/gocardless/oauth/callback`, webhook URL `https://wyndos.io/api/gocardless/webhook`).
- Ask GoCardless to enable refunds in the sandbox.
- User guide URL: https://wyndos.io/guide/direct-debit (public, part of the guide).
- High-resolution logo.
