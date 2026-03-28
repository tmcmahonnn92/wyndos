# Wyndos Window Cleaning App

Multi-tenant route management for window cleaning businesses. The current rollout goal is to get the app ready for deployment to a single Ubuntu VPS with PostgreSQL, Nginx, and systemd.

## Current rollout status

This repository is mid-hardening. Core tenancy, auth, onboarding, recurrence, and settings-secret fixes are being applied in preparation for VPS deployment.

Currently disabled for the production-readiness pass:

- Invoice email delivery
- SMS sending
- Broadcast messaging

These routes and UI actions are intentionally disabled until the core tenancy and deployment work is complete.

## Core features in scope

- Multi-tenant owner and worker accounts
- Dashboard, schedule, day view, areas, customers, and payments
- Rolling recurrence based on actual completion date
- Outstanding balances and invoice PDF generation
- Team invites and permissions

## Local development

Current local setup still defaults to SQLite unless `DATABASE_URL` is set.

```bash
npm install --legacy-peer-deps
npm run dev
```

Recommended local environment variables:

```bash
DATABASE_URL=file:./dev.db
AUTH_SECRET=replace-this-for-local-dev
NEXTAUTH_URL=http://localhost:3000
NODE_ENV=development
```

If you need a reset, use the Prisma commands carefully. The checked-in seed path is still being repaired as part of the bootstrap and PostgreSQL migration work.

## Production target

Target topology:

- Ubuntu 22.04 LTS VPS
- Nginx as reverse proxy and TLS terminator
- Next.js app running under systemd
- PostgreSQL on the same VPS, bound to localhost only
- UFW allowing only SSH, HTTP, and HTTPS
- Health checks against `/api/health`

This repository should not be treated as ready for shared-hosting or SQLite-file production deployment.

## Required environment variables

Minimum required variables for a production deployment:

```bash
DATABASE_URL=postgresql://app_user:strong-password@127.0.0.1:5432/window_cleaning_app
AUTH_SECRET=generate-a-long-random-secret
AUTH_URL=https://your-domain.example
AUTH_TRUST_HOST=true
NEXTAUTH_URL=https://your-domain.example
APP_URL=https://your-domain.example
NODE_ENV=production
PORT=3000
```

Notes:

- `AUTH_SECRET` is required in production. The app now fails fast if it is missing.
- `DATABASE_URL` is now used by runtime and seed bootstrapping instead of a hardcoded `dev.db` path.
- Tenant SMTP settings remain available in the settings UI, but platform-level auth mail can use `PLATFORM_SMTP_*` when tenant SMTP is not configured.
- Set `AUTH_URL`, `NEXTAUTH_URL`, and `APP_URL` to the same public HTTPS origin on the VPS.
- `AUTH_TRUST_HOST=true` is required when the app runs behind Nginx.
- Use `PLATFORM_SMTP_SECURE=true` for SSL SMTP on port `465`; leave it `false` for STARTTLS on port `587`.

## Health check

A simple health endpoint is available at `/api/health`.

Expected success response:

```json
{
	"status": "ok",
	"database": "ok",
	"timestamp": "2026-03-26T12:00:00.000Z"
}
```

If the database connection fails, the endpoint returns HTTP `503`.

## Deployment notes

Use the repo runbook and deploy assets for VPS rollout:

- .env.production.example
- deploy/deploy-vps.sh
- deploy/RELEASE_WORKFLOW.md
- deploy/VPS_RUNBOOK.md
- deploy/nginx/wyndos.conf
- deploy/systemd/wyndos.service
- deploy/postgres/create-app-db.sql

Recommended VPS deploy order:

1. Provision Ubuntu, Node, PostgreSQL, Nginx, and UFW.
2. Create the PostgreSQL role and database.
3. Create /opt/wyndos/shared/.env.production from .env.production.example.
4. Pull the target GitHub commit on the VPS and run sudo ./deploy/deploy-vps.sh.
5. Install the systemd unit and Nginx site.
6. Verify /api/health locally and through the public HTTPS URL.
7. Run the manual smoke checks documented in deploy/VPS_RUNBOOK.md.

Recommended release workflow:

1. Validate locally with npm run build.
2. Commit and push to GitHub main.
3. On the VPS, run git fetch, git checkout main, git pull --ff-only origin main.
4. Run sudo ./deploy/deploy-vps.sh.
5. Verify systemctl status wyndos and both local and public /api/health.

Current limitation:

- A live PostgreSQL migrate-deploy run was not executed on this Windows workstation because no local PostgreSQL or Docker runtime is installed. The exact commands are documented and ready for the VPS.

## Scheduling rules

| Job outcome | Next due date |
|---|---|
| COMPLETE | Based on the actual completion date |
| SKIPPED | Based on the scheduled work day date |
| OUTSTANDING | Based on the scheduled work day date |
| MOVED then done | Based on the actual completion date on the moved day |
| Manual reschedule | Whatever date is explicitly set |

## Stack

Next.js 16, React 19, Tailwind CSS v4, Prisma 7, NextAuth v5 beta, date-fns, lucide-react


