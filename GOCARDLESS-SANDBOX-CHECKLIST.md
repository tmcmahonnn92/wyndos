# GoCardless sandbox checklist (before going live)

Run on your live Wyndos connected to the **sandbox** GoCardless account, with **Collect automatically** on
and refunds switched on. In GoCardless: **Developers → Scenario simulators** moves a payment along
(paste the payment ID from GoCardless → Payments). After each simulator, press **Sync now** in
Wyndos (or wait a minute for the webhook). Sandbox bank details: sort code 20-00-00, account 55779911.

| # | Do this | Expect in Wyndos | Expect in GoCardless |
|---|---------|------------------|----------------------|
| 1 | Customer A: Get sign-up link, fill it in | Direct Debit: Active | 1 mandate |
| 2 | Tick A's clean **Done** | Payments → Direct Debit → In progress: £price | 1 payment, pending submission |
| 3 | **Undo** the clean | Clean back to pending | That payment **Cancelled** |
| 4 | Tick it **Done** again | In progress again | A **new** payment (old one still cancelled) |
| 5 | Simulator **payment paid out** on the new payment, Sync | Clean paid, one £price payment on A, no credit | Paid out |
| 6 | Sync now twice more | Nothing changes | |
| 7 | Refund £5 **back through GoCardless** (write off) | Refund −£5 on A | Refund £5 |
| 8 | Refund £1000 | Refused: "up to £…" | Nothing |
| 9 | Refund the rest | Total refunded = the payment | Refunds add up to the payment, no more |
| 10 | Customer B: tick Done, simulator **payment failed**, Sync | Under Failed, clean owes, **Try again** shown | Failed |
| 11 | Press **Try again** twice quickly | One new collection | One new payment only |
| 12 | Simulator **paid out** on it, Sync | Clean paid once | |
| 13 | Customer C: tick Done, **paid out**, then **charged back**, Sync | Clean owes again, "Ask the customer" (no Try again) | Charged back |
| 14 | Customer D: **Use another customer's Direct Debit** → A. Tick D's clean | One payment on A's Direct Debit, description names D's house | |
| 15 | Customer E: tick Done, then **Done & Paid** cash for it / log cash for that clean | Direct Debit collection cancelled | Payment cancelled |
| 16 | Compare: GoCardless total paid out vs Wyndos Direct Debit payments | Same total | |

Anything different from "Expect": stop and send a screenshot.

Also: never copy the live database to a test server with the GoCardless tokens in it (clear
`goCardlessAccessToken` first), or the test server could collect real money.
