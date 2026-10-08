# GoCardless (Direct Debit): testing on staging

Direct Debit only appears where the build has `NEXT_PUBLIC_GOCARDLESS_ENABLED=1`. Production stays off until this is signed off.

## Testing on your own computer (run-local.sh)

Add to `.env` (never commit it):
```
NEXT_PUBLIC_GOCARDLESS_ENABLED=1
GOCARDLESS_DEV_TOKEN=sandbox_...your sandbox token...
```
Run `./run-local.sh`. The dev token is used when no token is saved in Settings (local only, never on the live server).
There's no cron locally: press **Sync now** instead. Then follow steps 2–11 below.

## 1. Set up on staging (once)

1. GoCardless **sandbox** account: https://manage-sandbox.gocardless.com/signup
2. Sandbox dashboard → **Developers → Create → Access token** → name "Wyndos staging", **Read-write**. Copy it.
3. Staging `.env.production` (`/opt/wyndos-staging/shared/.env.production`): add
   `NEXT_PUBLIC_GOCARDLESS_ENABLED=1` (and make sure `CRON_SECRET` is set). Redeploy staging (it's read at build time).
4. Run the database migration (deploy does this): `20261008100000_gocardless_collect`.
5. Cron on the VPS (staging is behind a password, so call it directly on its port):
   ```
   0,15,30,45 * * * * curl -fsS -H "Authorization: Bearer STAGING_CRON_SECRET" http://127.0.0.1:3001/api/cron/gocardless >/dev/null
   ```

## 2. Connect

1. Staging → Settings → Business → **GoCardless (Direct Debit)**: Environment **Sandbox**, paste token, **Save**.
2. **Test connection** → "Connected to <your sandbox business name>". (Wrong token → red message.)

## 3. Sign-up link (new Direct Debit)

1. Payments → **Direct Debit** → Customers → pick a test customer → **Get sign-up link**.
2. Open the link (private window). Name/address are pre-filled. Use GoCardless sandbox test bank details
   (from their sandbox docs, e.g. sort code 20-00-00, account 55779911).
3. You land on the "Thank you" page.
4. Back in Wyndos → **Sync now** → "1 new Direct Debit linked". Customer shows *Being set up*, then *Active* after later syncs
   (speed up: GoCardless sandbox → Developers → **Scenario simulators** → *Mandate activated*).

## 4. Link customers already in GoCardless

1. In the GoCardless sandbox, create 2–3 customers with mandates (or use the sign-up link a few times).
2. Wyndos → Direct Debit → **Link GoCardless customers** → **Load from GoCardless**.
3. Check the *Suggested* matches (email, then name + postcode). Change or set "Don't link". **Save links**.
4. Customers tab shows them with their status.

## 5. Collect

1. Complete a clean (Workday) for a linked customer, don't mark it paid.
2. Direct Debit → **To collect** shows it ticked → **Collect £X**.
3. GoCardless sandbox → Payments: a payment for that amount, description "Window Cleaning <date>", metadata wyndosJobId.
4. Wyndos → **In progress** shows it (*Being set up* / *Submitted*).

## 6. Money received

1. Sandbox → Scenario simulators → **Payment paid out** (or *confirmed*) on that payment.
2. Wyndos → **Sync now** → "1 payment received". The clean is paid on the customer (method Bank, note "Direct Debit (GoCardless)").

## 7. Failure and retry

1. Collect another clean → simulate **Payment failed**. Sync → "1 failed".
2. **Failed** tab shows it; the clean still owes on the customer.
3. **Try again** → a new GoCardless payment (new idempotency key).

## 8. Charged back

1. On a paid-out payment simulate **Payment charged back**. Sync.
2. The Wyndos payment is voided ("Direct Debit charged back") and the clean owes again; it shows under Failed.

## 9. Mandate cancelled

1. Simulate **Mandate cancelled** (or cancel in the dashboard). Sync.
2. Customer shows *Cancelled*; collecting for them is skipped with the reason.

## 10. Auto-collect

1. Tick **Collect automatically when a clean is done**.
2. Complete a clean for a linked customer. Wait for cron (or Sync now) → collected automatically.
3. Cleans completed *before* the tick are never auto-collected.

## 11. Safety checks

- Collect the same clean twice (double-click, two tabs): only one GoCardless payment.
- A worker account can't open /payments/direct-debit.
- `curl http://127.0.0.1:3001/api/cron/gocardless` without the secret → 401.
- Remove the token in Settings → Direct Debit page asks you to connect again.
