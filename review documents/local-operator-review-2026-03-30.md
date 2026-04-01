# Local Operator Review - 2026-03-30

## 1. Operational Test Context

- Environment tested: local development instance at `http://127.0.0.1:3000` running in Next.js dev mode
- Date tested: 2026-03-30
- Roles used: one seeded OWNER account and one invited WORKER account accepted through the app
- Assumptions made about the business model: UK domestic recurring round, owner plus one worker, area-based planning, 4-week, 8-week, and 12-week work cycles, overdue work and payment arrears treated as normal operating conditions
- Seeded round shape used for testing:
  - Walkley Friday: 4-week cycle, overdue active run
  - Crookes Loop: 8-week cycle, upcoming run
  - Ecclesall Edge: 12-week cycle, upcoming run
  - 9 active customers total with notes, mixed payment methods, and one customer balance outstanding
  - one holiday block seeded for forward planning review
- Workflows covered:
  - Owner desktop sign-in and dashboard review
  - Owner desktop schedule review on `/days`
  - Owner desktop scheduler review on `/scheduler`
  - Owner desktop customer-list review on `/customers`
  - Owner worker-invite flow from Settings > Team
  - Worker invite acceptance flow
  - Worker desktop dashboard and permission checks
  - Worker mobile schedule review on `/days`
  - Worker mobile day-route review on `/days/36`
  - Initial owner desktop day execution review on the overdue run
- Workflows not fully covered:
  - Full owner completion of the overdue day end-to-end in the browser
  - Drag-drop scheduler reshuffling under load across multiple future weeks
  - One-off customer move into another area run and the follow-up home-area skip behavior from the UI
  - Rain-backlog recovery across more than one overdue day at once
  - Payment entry from the day route in the worker flow

## 2. Confirmed Defects

### Defect 1
- Severity: High
- Area: Day planning / field schedule
- Title: Overdue active work is hidden behind an empty "Today" state
- Steps to reproduce:
  1. Sign in as the seeded owner or accepted worker
  2. Open `/days`
  3. Ensure an overdue active work day exists, in this run `Walkley Friday`
  4. Review the top "Today" section
- Expected operator outcome:
  - If there is overdue active work, the top section should surface it clearly as overdue or carry-over work
- Actual result:
  - The page says `Nothing scheduled today`
  - The overdue run still exists lower down in the calendar view
  - This happened for both owner desktop and worker mobile views
- Practical business impact:
  - A cleaner can open the app in the morning and be told there is nothing on, even though there is an overdue live run waiting
  - On a wet or catch-up week this is exactly how customers get missed

### Defect 2
- Severity: Medium
- Area: Worker permissions / dashboard
- Title: Worker dashboard exposes management and finance CTAs that lead to inaccessible areas
- Steps to reproduce:
  1. Invite a worker using the default worker permissions
  2. Accept the invite and sign in as the worker
  3. Open `/`
  4. Observe cards and CTAs such as `Manage`, `Log payment`, and `Schedule`
  5. Try opening `/customers`, `/settings`, or `/scheduler`
- Expected operator outcome:
  - Worker dashboard should only show actions the worker can actually use
- Actual result:
  - The worker dashboard shows business metrics and links related to customer management, payments, and scheduling
  - Attempting `/customers`, `/settings`, and `/scheduler` redirects the worker back to the dashboard
- Practical business impact:
  - The worker sees actions that are effectively dead ends
  - This creates confusion in the field and weakens role clarity for owner versus worker responsibilities

### Defect 3
- Severity: Medium
- Area: Mobile schedule messaging
- Title: Mobile empty-state instruction points workers to a page they cannot access
- Steps to reproduce:
  1. Sign in as the worker
  2. Open `/days` on a mobile viewport
  3. Trigger the empty-state at the top of the page
  4. Read the helper text
- Expected operator outcome:
  - Worker-facing copy should reference a valid worker workflow
- Actual result:
  - The message says `Head to Scheduler to plan a run.`
  - The worker cannot access `/scheduler`; attempts redirect back to the dashboard
- Practical business impact:
  - The app instructs the field worker to use a blocked desktop-only owner tool
  - This is confusing and makes the worker flow feel unfinished

### Defect 4
- Severity: Medium
- Area: Page-load behavior / field usability
- Title: Full-screen loading/splash overlay obscures key screens long after the page content is already underneath it
- Steps to reproduce:
  1. Open `/days`, `/customers`, or a day route on desktop or mobile
  2. Watch the screen immediately after route load
- Expected operator outcome:
  - Page content should become usable as soon as it is loaded
- Actual result:
  - A large full-screen dark loading overlay with the Wyndos pin remains over the page while the underlying content is already present
  - This was visible in captured local screenshots for owner and worker screens
- Practical business impact:
  - Repeated route changes in the van or on the pavement feel slower than they need to
  - It delays confidence in what is due next, especially when moving between schedule and route screens

## 3. Operational Friction

- Desktop planning is split awkwardly between Dashboard, Schedule, and Scheduler. The dashboard correctly showed `1 overdue area`, but the schedule screen then told the operator there was nothing scheduled today. In real round management that forces the owner to cross-check multiple screens before deciding what to load into the van.
- The day route UI is visually fast once the cards are visible, with inline action bars like `Done` and `Done & Paid`, but the repeated action rows across each job create a dense screen. It feels better for quick tapping than a modal-heavy flow, but it needs clearer emphasis of which job is being acted on when several similar cards are stacked.
- The worker mobile screen can open the overdue run directly if you know where it is, but the normal entry path does not guide the worker to it. That means the actual work is present in the system but not operationally surfaced.
- The scheduler appeared to contain the seeded areas and scheduled runs, but the holiday cue was not obvious during the tested pass. For an owner planning several weeks out, holidays need to stand out immediately rather than requiring hunting.
- Settings > Team worked as a practical owner workflow. Creating an invite link from the same screen is sensible and realistic for a small round owner.

## 4. Feature Requests

- Add an `Overdue` section above `Today` on `/days` for both owner and worker views.
  - Real-world problem solved: overdue runs are routine on a domestic round and need to be visible without opening the calendar.
  - Audience: both
- Add a worker-focused empty state for `/days` that says what to do next in worker terms, for example `No work allocated today` or `Ask the owner to assign or reschedule work`.
  - Real-world problem solved: current copy assumes owner access to the scheduler.
  - Audience: worker-focused
- Add a field-mode toggle or simplified worker dashboard that removes finance tiles, overdue-area planning metrics, and owner-only management language.
  - Real-world problem solved: workers need route clarity, not office metrics.
  - Audience: both
- Make holiday blocks or holiday conflicts visually stronger in Scheduler.
  - Real-world problem solved: holiday planning should be obvious when moving area runs forward across several weeks.
  - Audience: owner-focused
- Add a `carry over from previous date` badge to overdue live days.
  - Real-world problem solved: workers need immediate confidence that a run is intentionally still open and not duplicated by mistake.
  - Audience: both

## 5. Business-Rule Mismatches

- The worker role still sees business summary metrics such as round value, total earned, total owing, overdue areas, and customers owing on the dashboard. For a normal UK domestic round, that is usually owner-office information, not something a field worker needs by default.
- The empty schedule copy assumes that if no work is today, the right next step is planning. In real use, a worker is not planning the round; they are waiting for assigned work or carrying over overdue work.

## 6. Blockers And Unknowns

- The local review was run in Next.js dev mode, not a production build. A red dev `1 Issue` badge was visible on a mobile screenshot. That badge itself is not a production defect, but it did confirm that local dev-only overlays were present during testing.
- The day-completion test hit a browser-automation ambiguity because several visible `Done` buttons were present at once. Visually that seems to come from the inline action layout rather than a broken route, but it limited full automated completion coverage.
- I did not confirm whether the long loading overlay behavior is identical in production, although it is clearly present in the local product flow.

## 7. Coverage Gaps

- True rain-backlog recovery with several overdue area runs still needs testing
- One-off customer move from home area into another area run still needs direct UI testing
- Payment collection from the worker route view still needs end-to-end testing
- Team-permission editing after invite creation still needs testing
- Scheduler drag/drop across multiple future weeks and collision handling still needs a dedicated pass

## Evidence Notes

- Screenshots saved during local testing:
  - `review documents/local-owner-days-before.png`
  - `review documents/local-owner-scheduler.png`
  - `review documents/local-owner-customers.png`
  - `review documents/local-worker-desktop-dashboard.png`
  - `review documents/local-worker-mobile-days.png`
  - `review documents/local-worker-mobile-day-view.png`
  - `review documents/local-owner-day-before-complete.png`
- Structured automation notes saved in:
  - `review documents/local-operator-sim-output-2026-03-30.json`

## Operator Verdict

- The application already has the right broad split between owner desktop planning and worker mobile execution.
- The biggest operational weakness in this local pass is overdue-work visibility. The product knows overdue work exists, but the primary schedule screen still tells the operator or worker that nothing is scheduled today.
- If that one area is corrected, the app becomes much closer to a practical live-round tool. Until then, it still risks the exact failure a working window cleaner cares most about: opening the app on a busy day and missing work that is already overdue.