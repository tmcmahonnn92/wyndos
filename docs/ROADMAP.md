# Wyndos roadmap

Things agreed but not built yet. Newest first. Move an item to "Done" (with the bundle/commit) when it ships.

## Next up

### Refunds (asked 12 Oct 2026)
Today there's no refund: you can only void a payment (wrong for refunds: hides the income), or refund in GoCardless and add an expense (profit right, turnover overstated).
1. **Refund button on a payment**: amount, reason, how it went back (cash / bank transfer / Direct Debit). Recorded as money out; the original payment stays. Accounting, "Sales v money in" and MTD figures go down.
2. **What happens to the clean**: "Refund and write off" (clean stays done, no longer owed — poor job / goodwill) or "Refund and leave it owing" (clean back to unpaid — mistakes, double charge).
3. **Refund spare credit** to a customer who's overpaid or leaving.
4. **GoCardless**: refund through GoCardless from the button (refunds must be enabled on the business's GoCardless account first), and sync picks up refunds made in the GoCardless dashboard.
- Quick interim option: an expense category "Customer refund" that comes off income (not counted as a cost) in Accounting and MTD.

### Smaller items
- Normal import: split 8-weekly customers inside 4-weekly areas into "<Area> 8 weekly" (as smart import does)? Waiting on Tom.
- Warn when a customer is moved into an area on a different cycle (they wait for that area's next run).
- Payments in an MTD-locked quarter can still be changed (record, void, edit, undo bank import).
- Two `applyCredit` calls at once could spend the same credit twice (no transaction).
- `completeJob` stamps today, ignoring a back-dated day or offline tap time.

## Done
- (move items here when they ship)
