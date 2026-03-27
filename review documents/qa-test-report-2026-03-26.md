# QA Test Report

Date: 2026-03-26

## 1. Test Summary

Environment tested:

- Windows local development environment
- Next.js dev server at `http://localhost:3000`
- SQLite database at project root `dev.db`
- Browser-driven QA executed with a temporary Playwright harness outside the repo

Roles and users tested:

- Owner Alpha in tenant `Alpha Window Cleaning`
- Worker Alpha invited into Alpha with default permissions
- Owner Beta in a separate tenant `Beta Window Cleaning`

Devices and viewports tested:

- Desktop around `1440x900`
- Mobile around `390x844`

Areas covered:

- Owner signup
- Owner sign-in
- Owner onboarding
- Worker invite acceptance
- Owner and worker permission boundaries
- Tenant isolation across separate owners
- Day view and schedule view
- Cross-area one-off move flow
- Day completion and next-run creation
- Mobile schedule workflow

Areas explicitly not tested:

- Invoice SMS functionality
- Broadcast functionality
- Password reset and email recovery flows
- External email or messaging delivery
- Super-admin tenant switching
- Monthly recurrence behavior
- Holiday rescheduling flows
- Full payment edge-case coverage

## 2. Findings

### Finding 1

Severity: High

Area: Scheduling

Title: Next run is calculated from the scheduled date instead of the actual completion date

Steps to reproduce:

1. Create or use a weekly area with a 4-week frequency
2. Set or schedule a run for a future date
3. Open that run on an earlier actual date and complete it
4. Observe the created next run and stored area dates

Expected result:

- Completion should be recorded on the actual date performed
- The next occurrence should be created on the same weekday at the configured interval based on the actual performed date

Actual result:

- The completed work day date was moved to the actual date performed
- The area `lastCompletedDate` and `nextDueDate` were still calculated from the original scheduled date
- In the reproduced case, a future-dated 4-week run completed on 2026-03-26 created the next run on 2026-05-21 instead of 2026-04-23

Risk or impact:

- Recurrence drifts late
- Historical reporting becomes inconsistent
- Operators can miss a full service cycle

Classification:

- Scheduling
- Data integrity

### Finding 2

Severity: High

Area: Authentication / onboarding

Title: Owner onboarding save succeeds but the UI remains stuck on the onboarding page

Steps to reproduce:

1. Sign up as a new owner
2. Reach the onboarding form
3. Fill company details and submit

Expected result:

- The app should redirect to the main dashboard after a successful save

Actual result:

- The POST completed successfully and onboarding data persisted in the database
- The page remained on `/auth/onboarding` showing a `Saving...` state until manual navigation or a fresh sign-in

Risk or impact:

- New-account setup appears broken even when persistence succeeds
- Users can abandon onboarding or create duplicate attempts
- This blocks the expected first-run path

Classification:

- UI
- Authentication

### Finding 3

Severity: High

Area: Local bootstrap / data setup

Title: Repository migration and seed workflow does not produce a runnable demo environment

Steps to reproduce:

1. Install dependencies
2. Run Prisma migration reset or dev migration flow
3. Run the documented seed command

Expected result:

- A clean local database with runnable demo data

Actual result:

- Prisma reported drift against the checked-in database state
- After reset, the current schema and migration history did not line up cleanly
- The seed script then failed because it expected tenant-aware tables and relationships that were not satisfied by its own create logic

Risk or impact:

- QA and development setup is unreliable
- Reproducible testing is slowed by environment failures before app behavior can even be exercised
- Demo data can no longer be trusted as a baseline for validation

Classification:

- Blocker
- Data integrity

## 3. Confirmed Working Behavior

- Owner Beta did not inherit Alpha tenant data in dashboard, areas, customers, or schedule views
- Worker Alpha could access the schedule and dashboard flows allowed by default permissions
- Worker Alpha was redirected away from restricted routes including areas, customers, settings, scheduler, and payments
- A customer moved from North Run into South Run as a one-off appeared on the South day as a one-off job
- That same customer was marked skipped on the original North occurrence only
- On the next normal North run, that customer returned to the original area as expected
- Mobile schedule view remained usable for a worker and showed due work for today
- Owner mobile visit to the scheduler displayed the intended desktop-only fallback message

## 4. Unclear Behavior

- The worker dashboard still shows tenant-wide KPI and action language even when the same worker cannot access several linked routes. It is unclear whether this is intentional or a permission-UX gap.
- The `/outstanding` route redirected back to the schedule view in this pass. It is unclear whether this is deliberate route consolidation or an unfinished path.

## 5. Improvement Opportunities

- Replace the onboarding post-submit flow with a guaranteed hard redirect or an explicit success handoff
- Repair migration history and seed logic so local setup follows the documented commands without manual intervention
- Hide or disable dashboard actions that a restricted worker cannot open
- Surface cross-area one-off notes more prominently on skipped home-area jobs

## 6. Blockers

- The checked-in seed flow was unusable for this QA pass
- The owner onboarding flow required manual navigation or re-login after a successful save

## 7. Coverage Gaps

- No super-admin workflow validation was completed
- No monthly recurrence validation was completed
- No holiday scheduling validation was completed
- No end-to-end invoice or payment edge-case validation was completed
- No external provider integration testing was completed