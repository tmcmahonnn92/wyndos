# SaaS Rollout Plan

Last reviewed: 2026-03-26

## Purpose

This document defines the exact work required before production deployment, the recommended deployment plan for an Ubuntu 22.04 Hostinger VPS, and the staged hardening work that should follow launch.

It is based on the current repository state, not on an assumed future architecture.

## Current Verdict

Status: Not ready for multi-tenant production deployment.

The application already has a tenant-aware data model, but production rollout is currently blocked by tenant-isolation gaps, unsafe ID-based mutations, API routes that are not consistently tenant-scoped, brittle production configuration, and an outdated SQLite-based deployment path in the README.

## Target Production Shape

Recommended initial production topology:

- Ubuntu 22.04 LTS VPS on Hostinger
- Nginx as reverse proxy and TLS terminator
- Next.js app running as a systemd service on localhost
- PostgreSQL on the same VPS, bound to localhost only
- UFW firewall allowing only SSH, HTTP, and HTTPS
- Hostinger VPS backups enabled
- Nightly pg_dump backups in addition to Hostinger snapshots

For the current customer projection, one VPS is acceptable. PostgreSQL should be used instead of SQLite for production.

## Exact Changes Required Before Deployment

These items are pre-deployment requirements, not optional improvements.

### 1. Fix tenant isolation in server actions

Problem:

- Multiple actions fetch the active tenant ID and then update or delete records by raw primary key only.
- This allows cross-tenant record access if a user can supply another tenant's integer IDs.

Files requiring immediate review and remediation include:

- src/lib/actions.ts
- src/app/api/customers/search/route.ts
- src/app/api/work-days/route.ts
- src/app/api/invoice/pdf/route.ts
- src/app/api/invoice/email/route.ts
- src/app/api/sms/send/route.ts

Minimum required change:

- Every read, update, delete, and create path touching tenant-owned data must resolve the active tenant first.
- Every lookup by ID must also verify tenant ownership before proceeding.
- Replace raw update/delete by primary key with tenant-scoped queries or guarded existence checks.

Required implementation standard:

- No business-data mutation should run against Area, Customer, WorkDay, Job, Payment, Tag, Holiday, Invite, or TenantSettings unless tenant scope is verified in the same code path.
- A shared guard/helper layer should be introduced so tenant checks are not left to developer memory.

### 2. Fix tenant isolation in API routes

Problem:

- Some API routes return or act on tenant data without tenant scoping.
- Some routes combine caller-scoped settings with arbitrary customer or job IDs.

Required changes:

- Protect every tenant data API route with auth and active tenant resolution.
- Ensure all customerId, jobId, workDayId, areaId, and tagId inputs are verified against the active tenant.
- Reject requests where ownership does not match.

Immediate route set to rewrite or re-audit:

- src/app/api/work-days/route.ts
- src/app/api/customers/search/route.ts
- src/app/api/invoice/pdf/route.ts
- src/app/api/invoice/email/route.ts
- src/app/api/sms/send/route.ts
- src/app/api/messaging/broadcast/route.ts
- src/app/api/areas/route.ts

### 3. Remove unsafe production auth fallback

Problem:

- The auth configuration falls back to a known development secret if AUTH_SECRET is not set.

Files:

- src/auth.ts
- src/auth.config.ts

Required changes:

- In production, fail startup if AUTH_SECRET is missing.
- Keep any fallback secret limited to local development only if absolutely necessary.

### 4. Stop hardcoding the runtime database file

Problem:

- The Prisma runtime client is currently wired to dev.db instead of following DATABASE_URL.
- This creates a mismatch between migrations and runtime configuration.

Files:

- src/lib/db.ts
- prisma.config.ts
- README.md

Required changes:

- Make runtime database configuration derive from DATABASE_URL.
- Remove production assumptions based on dev.db or prod.db file names.
- Replace the SQLite production README guidance with a PostgreSQL deployment guide.

### 5. Move production database target to PostgreSQL

Problem:

- SQLite is acceptable for local development but is a weak production fit for multi-tenant SaaS operations on a VPS.
- It increases operational fragility around concurrency, backups, restore confidence, and single-instance constraints.

Required changes:

- Change the Prisma datasource to PostgreSQL for production use.
- Create a migration path from the current SQLite data model to PostgreSQL.
- Validate generated client behavior and any raw queries against PostgreSQL.

Files likely affected:

- prisma/schema.prisma
- src/lib/db.ts
- prisma migrations and environment configuration

### 6. Encrypt tenant-stored provider credentials

Problem:

- SMTP and messaging credentials are stored as plaintext in TenantSettings.

Files:

- prisma/schema.prisma
- src/lib/actions.ts
- src/lib/messaging.ts
- settings UI components under src/app/settings

Required changes:

- Encrypt sensitive third-party credentials at rest using a server-side encryption key.
- Prevent secrets from being exposed to client components beyond what is strictly necessary.
- Review whether worker users should ever receive the settings permission in production.

### 7. Add production-safe logging and error handling

Problem:

- There is no visible production observability standard in the repository.

Required changes:

- Add structured server logging for startup failures, auth errors, messaging failures, invoice failures, and critical write operations.
- Ensure logs do not print passwords, tokens, or provider secrets.
- Add a health-check endpoint suitable for uptime monitoring.

### 8. Add tenant-isolation regression tests

Problem:

- There is no visible automated test setup covering authorization or tenant isolation.

Required changes:

- Add integration or end-to-end tests that prove one tenant cannot read or mutate another tenant's data.
- Add tests for admin tenant switching, owner access, worker permission boundaries, and invoice/message route authorization.

### 9. Add operational indexes before production growth

Problem:

- The schema uses some unique constraints, but common tenant and history access paths need explicit indexing once data grows.

Required changes:

- Add indexes for common filters such as tenantId, areaId, customerId, workDayId, paidAt, completedAt, and date-based planner queries.
- Review dashboard, payments, scheduler, and outstanding-job queries after moving to PostgreSQL.

### 10. Replace the current deployment documentation

Problem:

- The README still documents SQLite file deployment on Hostinger shared-style Node hosting.

Required changes:

- Remove or rewrite the outdated deployment section.
- Make this rollout document the source of truth until a final production runbook is added.

## Pre-Deployment Checklist

Deployment should not proceed until every item below is complete.

- Tenant-isolation audit completed for all server actions and API routes
- Cross-tenant mutation paths removed
- Production auth secret enforcement added
- PostgreSQL configured and working locally or in staging
- Migrations tested end-to-end against PostgreSQL
- Runtime config uses DATABASE_URL consistently
- Sensitive provider credentials encrypted at rest
- Health check implemented
- Server logging implemented
- Backup and restore procedure tested
- Basic deployment rollback procedure written
- Smoke test checklist written and executed against staging
- README deployment section updated

## Deployment Plan

### Phase 0: Local hardening

Goal: make the codebase safe enough to deploy.

Steps:

1. Fix tenant isolation and auth/config issues.
2. Move runtime DB configuration to DATABASE_URL.
3. Switch production target to PostgreSQL.
4. Add tests for tenant isolation and route access.
5. Replace outdated README deployment guidance.

Exit criteria:

- App runs locally against PostgreSQL
- Key user flows work for owner, worker, and super admin
- Isolation tests pass

### Phase 1: Staging on VPS

Goal: prove the production topology before real customer rollout.

Recommended staging steps:

1. Provision Ubuntu 22.04 VPS.
2. Install system packages:
   - nginx
   - postgresql
   - nodejs LTS
   - npm
   - ufw
3. Create a dedicated Linux user for the app.
4. Create a PostgreSQL database and restricted application user.
5. Set environment variables for the app:
   - DATABASE_URL
   - AUTH_SECRET
   - NEXTAUTH_URL or APP_URL
   - any SMTP or messaging secrets
   - encryption key for stored provider credentials
6. Build and run the app as a systemd service.
7. Put Nginx in front of the app with HTTPS.
8. Enable firewall rules.
9. Add uptime checks and log review.
10. Run smoke tests manually.

Exit criteria:

- App reachable over HTTPS
- Sign-in and onboarding work
- CRUD flows work
- Messaging and invoice flows behave safely
- Restarting the app does not corrupt data or break login sessions

### Phase 2: Production cutover

Goal: launch to the first real tenants.
