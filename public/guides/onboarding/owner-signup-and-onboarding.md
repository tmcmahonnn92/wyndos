# Owner Signup And Onboarding

## 1. Guide Summary

- Audience: New owner or admin setting up a fresh Wyndos.io account
- Environment tested: Local app at `http://localhost:3000`
- Workflow covered: Account signup, owner onboarding, and first redirect to the dashboard
- Desktop and mobile coverage status: Verified on desktop and iPhone 13-sized mobile viewport
- Output locations for markdown files and screenshots: This guide is in `public/guides/onboarding/owner-signup-and-onboarding.md` and screenshots are in `public/guides/onboarding/screenshots`

## 2. Guide

### Purpose

Use this guide to create a new owner account and complete the initial business setup so you land on the main dashboard.

### Prerequisites

1. The app is running locally at `http://localhost:3000`.
2. You have an email address that has not already been used in the system.
3. You have a password with at least 8 characters.

### Step 1. Open the signup page

1. Go to `http://localhost:3000/auth/signup`.
2. Confirm the page heading says `Create your account`.
3. Review the intro text `Get started — it's free` and `Enter your details below to set up your window cleaning round.`

Screenshot references:

- Desktop: `screenshots/desktop-01-signup-page.png`
- Mobile: `screenshots/mobile-01-signup-page.png`

Expected result: The signup form is visible with fields for your name, company, email, password, and password confirmation.

### Step 2. Complete the signup form

1. Enter a value in `Your full name`.
2. Enter your business name in `Company / trading name`.
3. Enter your email in `Email address`.
4. Enter your password in `Password`.
5. Enter the same password again in `Confirm password`.
6. Select `Create account`.

Screenshot references:

- Desktop: `screenshots/desktop-02-signup-form-complete.png`
- Mobile: `screenshots/mobile-02-signup-form-complete.png`

Expected result: The app creates the account and redirects you to the onboarding screen at `/auth/onboarding`.

### Step 3. Review the onboarding page

1. Confirm the page heading says `Set up your business`.
2. Read the helper text `Tell us a bit about your window cleaning business. You can update these details any time from Settings.`
3. Check the `What happens next?` panel for the built-in next steps:
4. `Your round dashboard will be ready immediately`
5. `You can add areas and customers from the Areas and Customers pages`
6. `Invite workers from Settings ? Team`

Screenshot references:

- Desktop: `screenshots/desktop-03-onboarding-page.png`
- Mobile: `screenshots/mobile-03-onboarding-page.png`

Expected result: The onboarding form opens with required business details and a clear explanation of what becomes available next.

### Step 4. Fill in your business details

1. Review and complete `Company / trading name`.
2. Review and complete `Your name`.
3. Enter a contact number in `Phone number` if you want it stored straight away.
4. Enter your site URL in `Website` if you have one.
5. Enter your business location in `Business address`.
6. Select `Finish setup and go to dashboard`.

Screenshot references:

- Desktop: `screenshots/desktop-04-onboarding-form-complete.png`
- Mobile: `screenshots/mobile-04-onboarding-form-complete.png`

Expected result: The app saves the onboarding form and redirects you to the main dashboard.

### Step 5. Confirm the dashboard opens

1. Wait for the redirect to complete.
2. Confirm the main page heading says `Dashboard`.
3. On a new account, expect to see an empty-state dashboard with `No work day today`, `ROUND VALUE £0.00`, `TOTAL EARNED £0.00`, `CUSTOMERS 0`, `TOTAL OWING £0.00`, and `OVERDUE AREAS 0`.
4. On desktop, confirm the left navigation includes `Dashboard`, `Schedule`, `Scheduler`, `Customers`, `Areas`, `Payments`, and `Settings`.
5. On mobile, confirm the bottom navigation includes `Dashboard`, `Schedule`, `Customers`, `Areas`, `Payments`, and `Settings`.

Screenshot references:

- Desktop: `screenshots/desktop-05-dashboard-after-onboarding.png`
- Mobile: `screenshots/mobile-05-dashboard-after-onboarding.png`

Expected result: You land on a clean dashboard ready for setup work such as adding customers, areas, and planned days.

## 3. Mobile Notes

- The mobile signup and onboarding forms use the same field labels and button text as desktop.
- On mobile, the app switches to a compact top header and a fixed bottom navigation bar after onboarding.
- The mobile dashboard shows the same empty-state cards as desktop, but the content stacks vertically and the bottom tab bar remains visible while you scroll.

## 4. Issues And Blockers

- No broken steps blocked completion of signup or onboarding in this pass.
- After selecting `Finish setup and go to dashboard`, the app shows a short splash/loading screen before the dashboard settles. This did not prevent completion, but it is noticeable and may briefly delay what the user sees next.
- The onboarding helper text currently shows `Settings ? Team` with a `?` character in the label. That wording was preserved here because it is what the UI currently displays.

## 5. Coverage Gaps

- This guide covers owner signup and onboarding only. It does not cover area setup, customer creation, scheduling, payments, or worker invitation flows.
- The flow was verified in a local environment with synthetic test data rather than production services.