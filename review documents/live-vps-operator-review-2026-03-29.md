# Live VPS Operator Review - 2026-03-29

## 1. Operational Test Context

- Environment tested: live production domain `https://wyndos.io`
- Date tested: 2026-03-29
- Access method: direct live web access plus Playwright browser automation against the public VPS
- Roles used: attempted fresh owner signup and onboarding on the live system
- Assumptions made about the business model: UK domestic recurring window cleaning round, owner plus one worker, area-based round planning, 4/8/12 week cycles, normal backlog and weather disruption handling
- Workflows covered:
  - Public sign-in page reachability
  - Public sign-up page reachability
  - Live health endpoint
  - Fresh owner signup through to onboarding handoff
- Workflows not covered because of blocker:
  - Dashboard use after onboarding
  - Area creation and scheduling
  - Customer creation and round shaping
  - Worker invite and assignment in the live app
  - Day execution, skipping, one-off moves, rescheduling, and completion logic
  - Six-month recurrence and backlog simulation on the live VPS

## 2. Confirmed Defects

### Defect 1
- Severity: Critical
- Area: Authentication / owner onboarding
- Title: Fresh owner onboarding crashes on the live system immediately after account creation
- Steps to reproduce:
  1. Open `https://wyndos.io/auth/signup`
  2. Create a new owner account with valid name, company name, email, and password
  3. Submit the form and allow the app to redirect to `/auth/onboarding`
  4. Observe the onboarding page on the live domain
- Expected operator outcome:
  - A new owner should land on a working onboarding form, enter business details, finish setup, and reach the dashboard
- Actual result:
  - The live app crashes on `/auth/onboarding` with a client-side exception and the onboarding form does not render
  - Browser error captured during the live run:
    - `TypeError: Cannot destructure property 'update' of '(0 , a.useSession)(...)' as it is undefined.`
  - The rendered page shows:
    - `Application error: a client-side exception has occurred while loading wyndos.io`
- Practical business impact:
  - A new operator cannot complete setup on the live system at all
  - This is a day-zero production blocker: no new customer can onboard themselves into the app
  - It also prevents realistic field and planning validation because a clean owner account cannot get past first-run setup

## 3. Operational Friction

- No additional operational friction findings were recorded on the live VPS because the critical onboarding failure prevented access to real owner workflows.

## 4. Feature Requests

- No live-only feature requests were recorded from this session because the review was blocked before reaching operational workflows.

## 5. Business-Rule Mismatches

- None confirmed from direct live use in this session.
- The review could not reach recurrence, skip, one-off, reassignment, or backlog workflows, so round-practice mismatches remain unverified on the live system.

## 6. Blockers And Unknowns

- Critical blocker: fresh owner onboarding crashes on the live domain after signup
- Unknown pending follow-on checks because of that blocker:
  - Whether a newly created owner session can bypass onboarding manually and still access the dashboard
  - Whether existing owner accounts on the live environment are working normally
  - Whether worker invite, scheduling, and completion workflows are stable on the current production release
- Health endpoint was reachable and healthy during testing:
  - `/api/health` returned `status: ok`, `database: ok`
  - Reported release commit: `636dfae5a11e6729bbd26101c47bef4cc3a25b22`

## 7. Coverage Gaps

- The requested six-month operational simulation could not be executed on the live system because the product is currently blocked at first-run onboarding.
- Still requires live testing once the blocker is fixed:
  - Owner week planning across due and overdue work
  - Area-based round scheduling and rebalancing
  - Worker invite, permissioning, and field-day completion flow
  - Rain backlog recovery and catch-up planning
  - One-off job handling without damaging the normal cycle
  - Customer notes, payment state, and access details at point of work
  - Actual recurrence generation after completing live runs over simulated multi-cycle use

## Evidence Notes

- Public sign-in page was reachable on the live domain
- Public sign-up page was reachable on the live domain
- Failure screenshot saved as `review documents/live-vps-operator-failure-899268.png`
- Live browser run captured the onboarding exception directly during automated testing against the production domain

## Operator Verdict

- The live system is not currently fit for a genuine owner-operated round trial because a new operator cannot complete onboarding.
- From a real UK window cleaning business perspective, this is an immediate stop-ship issue for customer acquisition and live adoption.