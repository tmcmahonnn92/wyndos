# QA Execution Notes

Date: 2026-03-26

## Environment Setup Used

The app server was started locally from the project workspace.

Commands used:

```powershell
npm install --legacy-peer-deps
npx prisma migrate reset --force
npx prisma db push
npm run dev
```

Notes:

- `npm install` without `--legacy-peer-deps` failed because of an upstream peer conflict involving `next-auth` and `nodemailer`
- Prisma migrate reset completed, but the documented seed path did not
- `prisma db push` was required to align the local database with the current schema before continuing

## Seed and Bootstrap Outcome

The documented seed route was not usable as-is.

Observed failures:

- Migration history and database state were out of sync
- After reset, the seed path attempted operations against schema objects that did not line up with the migrated state
- After forcing schema alignment, the seed still failed because area creation did not satisfy current tenant requirements

Because of this, deterministic QA data was created directly in the local database for the active owner tenant after the app was running.

## Accounts Used

Primary test users created during the run:

- Owner Alpha: `ownera.1774490716997@example.test`
- Worker Alpha: `worker.1774491833887@example.test`
- Owner Beta: `ownerb.1774492093341@example.test`

Test password used for all created accounts:

- `Password123!`

These are synthetic local-only test accounts created during QA.

## Deterministic Test Data Added For Alpha Tenant

Areas used:

- `North Run` with 4-week cadence
- `South Run` with 8-week cadence
- `Quarterly Run` with 12-week cadence

Customers used:

- `Alice North`
- `Nina North`
- `Bob South`
- `Quinn Quarterly`

Planned work days used:

- North Run planned for 2026-04-23
- South Run planned for 2026-03-26

## Key Reproduced Scenarios

### Owner onboarding hang

- Owner signup completed
- Onboarding persistence succeeded server-side
- UI stayed on the onboarding page in a saving state

### Cross-area one-off behavior

- Added `Alice North` onto the South Run day as a one-off
- South Run showed Alice as a one-off job
- North Run showed Alice as skipped for that occurrence only

### Next normal return behavior

- Completed the North Run day
- The next North run was auto-created
- `Alice North` appeared back in that next normal North run as expected

### Recurrence bug

- The completed work day date moved to the actual performed date
- The area recurrence still advanced from the original scheduled date instead of the actual completion date

### Worker permission boundaries

- Worker could access dashboard and schedule
- Worker was redirected away from restricted routes including areas, customers, settings, scheduler, and payments

### Tenant isolation check

- Owner Beta saw an empty tenant with no Alpha customers, areas, or work days

## Residual Risk

This QA pass covered the highest-value scheduling, isolation, and permission flows that were reachable in the current environment. Residual risk remains around super-admin behavior, monthly recurrence, holiday handling, invoice generation, and payment edge cases.