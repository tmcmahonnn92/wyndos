# Wyndos roadmap

Things agreed but not built yet. Newest first. Move an item to "Done" (with the bundle/commit) when it ships.

## Next up

### Smaller items
- Normal import: split 8-weekly customers inside 4-weekly areas into "<Area> 8 weekly" (as smart import does)? Waiting on Tom.
- Warn when a customer is moved into an area on a different cycle (they wait for that area's next run).
- Two `applyCredit` calls at once could spend the same credit twice (no transaction).
- `completeJob` stamps today, ignoring a back-dated day or offline tap time.

## Done
- Refunds (Oct 2026): refund button on a payment (part or full; cash/bank/card or back through GoCardless; write off or leave owing), refund credit, dashboard refunds picked up by sync, failed refunds undone.
- Payments in an MTD-locked quarter are locked (cash basis).
