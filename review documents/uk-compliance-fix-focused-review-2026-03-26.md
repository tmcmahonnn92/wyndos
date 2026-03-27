# UK Compliance Fix-Focused Review

Date: 2026-03-26
Repository: Window Cleaning App
Review scope: UK GDPR and Data Protection Act 2018 readiness for a multi-tenant SaaS deployment on an Ubuntu VPS with a database backend.

## Executive Position

The application should not be rolled out to real tenants yet.

The primary blockers are not paperwork-first issues. The immediate blockers are engineering defects that can cause cross-tenant data exposure or unauthorized mutation, plus weak secret handling and incomplete production security assumptions.

A secure VPS with HTTPS is not enough if the application layer can still leak or alter another tenant's data. Fixing tenancy enforcement and secret handling is the first priority. Once that is done, the missing privacy, DPA, retention, subprocessor, and breach-response documentation needs to be completed before launch.

## Fix Priority

### P0: Must fix before any customer rollout

1. Enforce tenant ownership on every business-data read, write, update, delete, search, invoice, PDF, and messaging path.
2. Remove production auth-secret fallbacks and require secure environment configuration.
3. Stop exposing SMTP and messaging provider secrets to browser clients.
4. Fix destructive actions that currently operate on raw record IDs without tenant verification.
5. Replace the current SQLite deployment assumptions with the actual intended production stack, or defer production claims until that migration is complete.
6. Add the minimum legal and operational launch set: privacy notice, DPA, subprocessor list, retention/deletion policy, and breach-response procedure.

### P1: Should fix immediately after P0, before scaling beyond a tightly controlled pilot

1. Hash password reset tokens instead of storing them in plaintext.
2. Add structured audit logging for admin actions, tenant switching, destructive actions, invite flows, and messaging sends.
3. Define backup encryption, restore testing, and retention behavior.
4. Tighten super-admin access governance and support access policy.

### P2: Hardening after initial safe launch

1. Consider a service-layer or repository-layer tenancy guard rather than relying on scattered query filters.
2. Consider Postgres row-level security if the eventual architecture supports it cleanly.
3. Add tenant export and offboarding workflows.
4. Add periodic access review and secret rotation procedures.

## Findings And Fix Directions

### 1. Cross-tenant read exposure in public app APIs

Severity: Critical
Type: Confirmed code defect

Evidence:
- [src/app/api/customers/search/route.ts](src/app/api/customers/search/route.ts#L13)
- [src/app/api/customers/search/route.ts](src/app/api/customers/search/route.ts#L26)
- [src/app/api/customers/search/route.ts](src/app/api/customers/search/route.ts#L35)
- [src/app/api/work-days/route.ts](src/app/api/work-days/route.ts#L5)

What is wrong:
- Customer search returns jobs, customers by area, and general customer results with no tenant filter.
- Work-day listing returns recent work days with no tenant filter.

Why this matters:
- Any authenticated user hitting these routes may be able to enumerate other tenants' names, addresses, phone numbers, emails, job data, and operational schedule data.
- In UK SaaS terms, this is a direct confidentiality breach risk and a hard launch blocker.

Required fix direction:
- Require auth and resolve the active tenant at the route boundary.
- Apply tenant ownership checks before every query.
- For work-day lookups, join or filter through `tenantId` explicitly.
- For customer search by `workDayId` or `areaId`, first verify that the target work day or area belongs to the active tenant before returning anything.
- Add regression tests for cross-tenant access attempts using guessed IDs.

Recommended implementation pattern:
- Introduce route-local guard code that always does:
  - authenticate user
  - resolve `tenantId` via `getActiveTenantId()`
  - verify any supplied `customerId`, `areaId`, `workDayId`, `jobId`, or `paymentId` belongs to that tenant
  - only then perform the action

### 2. Cross-tenant mutation risk in server actions

Severity: Critical
Type: Confirmed code defect

Evidence:
- [src/lib/actions.ts](src/lib/actions.ts#L96)
- [src/lib/actions.ts](src/lib/actions.ts#L121)
- [src/lib/actions.ts](src/lib/actions.ts#L468)
- [src/lib/actions.ts](src/lib/actions.ts#L1104)
- [src/lib/actions.ts](src/lib/actions.ts#L1113)
- [src/lib/actions.ts](src/lib/actions.ts#L1147)
- [src/lib/actions.ts](src/lib/actions.ts#L1814)

What is wrong:
- Several actions fetch the active tenant but then mutate by raw `id` only.
- Examples include area update/delete, job delete, work-day start/delete, payment delete, and the bulk customer wipe path.
- `deleteAllCustomers()` is especially dangerous because it selects customers by non-system-area status without filtering by tenant first.

Why this matters:
- A tenant-scoped session is not enough if the mutation query itself does not enforce the tenant boundary.
- If an attacker or buggy client submits another tenant's record ID, these actions can alter or delete the wrong data.

Required fix direction:
- Never mutate by global `id` alone for tenant-owned records.
- Replace direct `update({ where: { id } })` and `delete({ where: { id } })` patterns with a verify-then-mutate flow.
- Example pattern:
  - look up the record with `where: { id, tenantId }` where possible, or `findFirst({ where: { id, tenantId } })`
  - fail if not found
  - then mutate the verified record
- For Prisma models that do not have a compound unique key on `(id, tenantId)`, add safe prechecks or add the compound unique/index where appropriate.
- Review every action in `src/lib/actions.ts` that accepts a raw ID from the client.

High-priority targets to refactor first:
- `updateArea`
- `deleteArea`
- `deleteAllCustomers`
- `removeJobFromDay`
- `startDay`
- `deleteWorkDay`
- `deletePayment`
- any action that updates jobs, payments, customers, work days, or areas by raw `id`

### 3. Invoice and messaging routes trust arbitrary IDs

Severity: Critical
Type: Confirmed code defect

Evidence:
- [src/app/api/invoice/email/route.ts](src/app/api/invoice/email/route.ts#L29)
- [src/app/api/invoice/email/route.ts](src/app/api/invoice/email/route.ts#L31)
- [src/app/api/invoice/pdf/route.ts](src/app/api/invoice/pdf/route.ts#L22)
- [src/app/api/invoice/pdf/route.ts](src/app/api/invoice/pdf/route.ts#L24)
- [src/app/api/sms/send/route.ts](src/app/api/sms/send/route.ts#L21)
- [src/app/api/sms/send/route.ts](src/app/api/sms/send/route.ts#L23)

What is wrong:
- Invoice email and PDF generation fetch customer and job records by supplied IDs without verifying tenant ownership.
- SMS sending can update a customer's phone number by `customerId` without verifying tenant ownership.

Why this matters:
- These routes create a realistic path for unauthorized viewing, exporting, emailing, or modifying another tenant's customer records.
- The impact is not only confidentiality. It also creates integrity risk because records can be mutated.

Required fix direction:
- Resolve active tenant inside each route.
- Verify that the target customer belongs to that tenant before proceeding.
- Verify that each job ID belongs to both the customer and the same tenant.
- Refuse mixed-tenant or mismatched input.
- Treat invoice generation and messaging as privileged processing and log these events.

### 4. Secrets are stored in plaintext and rendered into the browser

Severity: High
Type: Confirmed code defect and security design gap

Evidence:
- [src/lib/actions.ts](src/lib/actions.ts#L1980)
- [src/app/settings/page.tsx](src/app/settings/page.tsx#L8)
- [src/app/settings/settings-client.tsx](src/app/settings/settings-client.tsx#L20)
- [src/app/settings/settings-client.tsx](src/app/settings/settings-client.tsx#L160)
- [src/app/settings/settings-client.tsx](src/app/settings/settings-client.tsx#L166)
- [src/app/settings/settings-client.tsx](src/app/settings/settings-client.tsx#L169)
- [src/app/settings/settings-client.tsx](src/app/settings/settings-client.tsx#L172)
- [prisma/schema.prisma](prisma/schema.prisma#L31)

What is wrong:
- SMTP passwords, SMS API keys, and other provider tokens are stored as plaintext in tenant settings.
- `getBusinessSettings()` returns the full settings object.
- The settings page passes those values directly into a client component, meaning users with the settings page can read live secrets in the browser.

Why this matters:
- This breaks least privilege.
- A worker or compromised browser session with settings access can extract provider credentials.
- It materially increases breach impact and weakens your processor-side technical measures.

Required fix direction:
- Do not send provider secrets back to the client after storage.
- Split settings into two classes:
  - non-sensitive display settings
  - sensitive secrets
- Sensitive secret handling should become write-only or masked with explicit replacement flow.
- Restrict secret management to owner-level access only, not generic settings access.
- Long term, move secrets out of tenant-readable DB fields if operationally possible, or encrypt them at rest with an application-managed key.

Minimum acceptable near-term change:
- The browser should never receive actual stored secret values.
- Show placeholders such as "Configured" instead of the underlying token.

### 5. Unsafe production auth secret fallback

Severity: Critical
Type: Confirmed code defect

Evidence:
- [src/auth.ts](src/auth.ts#L23)
- [src/auth.config.ts](src/auth.config.ts#L17)

What is wrong:
- The application falls back to `dev-secret-change-me` if `AUTH_SECRET` is missing.

Why this matters:
- In production, session integrity depends on a strong, unknown secret.
- A default fallback removes that guarantee and is not acceptable for a SaaS handling personal data.

Required fix direction:
- In production, fail fast if `AUTH_SECRET` is missing.
- Keep a local-development fallback only when `NODE_ENV !== 'production'`.
- Document required environment variables clearly for deployment.

### 6. Password reset tokens are stored in plaintext

Severity: High
Type: Confirmed code defect

Evidence:
- [src/lib/auth-actions.ts](src/lib/auth-actions.ts#L469)
- [src/lib/auth-actions.ts](src/lib/auth-actions.ts#L515)
- [src/lib/auth-actions.ts](src/lib/auth-actions.ts#L533)

What is wrong:
- Password reset tokens are stored and validated in plaintext.

Why this matters:
- If the database is exposed, valid reset tokens can be replayed directly.
- That is avoidable and below the standard expected for an internet-facing SaaS auth system.

Required fix direction:
- Store only a hash of the reset token.
- Email the raw token to the user, but compare a hash at validation time.
- Invalidate old tokens on issue and on use, which the current flow already partially does.

### 7. Production deployment assumptions do not match the intended architecture

Severity: High
Type: Confirmed architecture and operational gap

Evidence:
- [prisma/schema.prisma](prisma/schema.prisma#L10)
- [src/lib/db.ts](src/lib/db.ts#L2)
- [src/lib/db.ts](src/lib/db.ts#L5)
- [README.md](README.md#L37)
- [README.md](README.md#L54)

What is wrong:
- The repo is currently configured for SQLite and file-based backup guidance.
- Your stated intended production target is Ubuntu VPS plus Postgres.

Why this matters:
- You cannot rely on Postgres/VPS security claims while the actual implementation and documentation still target SQLite.
- Backup, restore, file permissions, locking, and tenancy hardening assumptions differ materially.

Required fix direction:
- Decide whether production is truly Postgres now.
- If yes, migrate the schema, Prisma datasource, database client wiring, deployment docs, backup strategy, and restore procedure before launch.
- If not, adjust the rollout assumptions honestly and treat the current setup as a smaller, more fragile deployment.

### 8. Missing compliance and operational launch documents

Severity: High
Type: Documentation and operational gap

Evidence:
- No privacy notice found in workspace
- No DPA found in workspace
- No subprocessor disclosure found in workspace
- No retention schedule found in workspace
- No breach-response procedure found in workspace

What is wrong:
- The repository does not show the documents or operational artifacts needed for a UK SaaS that processes tenant customer data.

Why this matters:
- Even with good code, you still need transparency, processor terms, and an operational response model.
- Tenants need a DPA. Data subjects need transparency at the right layer. You need internal accountability records.

Required fix direction:
- Create before launch:
  - privacy notice
  - terms of service
  - DPA
  - subprocessor list
  - retention and deletion policy
  - incident and breach response procedure
  - internal records of processing activities

## Recommended Engineering Approach

### Short-term containment

1. Freeze launch until P0 tenancy and secret-handling fixes are complete.
2. Review every API route under `src/app/api/**` for direct ID-based access.
3. Review every action in `src/lib/actions.ts` that accepts an ID or array of IDs.
4. Remove client-side visibility of stored provider credentials.
5. Fail hard in production when security-critical env vars are missing.

### Safer tenancy pattern

Apply one consistent rule:

- no controller, route, or action may trust a raw record ID from the client
- every tenant-owned record must be resolved against the active tenant before use
- every destructive action must verify ownership before mutation

Practical implementation options:

1. Add helper functions such as `requireTenantCustomer(customerId)`, `requireTenantArea(areaId)`, `requireTenantWorkDay(workDayId)`, `requireTenantJob(jobId)`, and `requireTenantPayment(paymentId)`.
2. Refactor routes and actions to call those helpers first.
3. Add compound unique keys where helpful so safe `where` clauses can be expressed more directly.
4. Add automated tests for cross-tenant ID guessing.

### Secret-handling target state

1. Settings page fetches non-sensitive settings separately from secrets.
2. Secrets are never returned after initial submission.
3. Only owners can rotate or replace secrets.
4. Optional but recommended: encrypt sensitive provider credentials at rest using an application key not stored in the database.

## Suggested Work Order

1. Fix `src/app/api/customers/search/route.ts`.
2. Fix `src/app/api/work-days/route.ts`.
3. Fix invoice email, invoice PDF, and SMS routes.
4. Refactor destructive actions in `src/lib/actions.ts` starting with the ones documented above.
5. Remove secret values from settings page responses.
6. Remove auth secret fallback in production.
7. Hash password reset tokens.
8. Migrate to Postgres if that is the actual production target.
9. Finalize privacy, DPA, subprocessor, retention, and breach documents.

## What "Compliant Enough To Launch" Looks Like

For a small UK launch on a VPS, the minimum credible position is:

- tenant isolation defects fixed
- no plaintext provider secrets exposed to browser clients
- production auth configuration locked down
- encrypted backups and tested restore path
- privacy notice, terms, DPA, and subprocessor list live
- documented breach-response and deletion/retention behavior
- clear controller/processor split in contracts

Until then, the main risk is not that tenants enter the data themselves. The main risk is that the platform currently does not enforce the boundary strongly enough or document the processing posture clearly enough.

## Recommended Next Step

After this document, the highest-value follow-up is a code remediation pass focused on:

1. tenancy guards for every ID-based route and action
2. settings secret exposure removal
3. production auth and reset-token hardening

