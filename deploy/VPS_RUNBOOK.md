# VPS Runbook

## 1. Provision host

Target:
- Ubuntu 22.04 LTS
- Node.js 22 LTS
- PostgreSQL 16+
- Nginx
- systemd
- UFW

Install packages:

```bash
sudo apt update
sudo apt install -y nginx postgresql postgresql-contrib ufw curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Create app user and directories:

```bash
sudo useradd --system --create-home --shell /bin/bash wyndos
sudo mkdir -p /opt/wyndos/current /opt/wyndos/shared /var/log/wyndos
sudo chown -R wyndos:wyndos /opt/wyndos /var/log/wyndos
```

## 2. Configure PostgreSQL

Use the included SQL as a starting point:

```bash
sudo -u postgres psql -f /opt/wyndos/current/deploy/postgres/create-app-db.sql
```

Recommended production connection string:

```bash
postgresql://app_user:replace-with-strong-password@127.0.0.1:5432/window_cleaning_app
```

## 3. Create production env file

Create /opt/wyndos/shared/.env.production from .env.production.example.

Required values:
- DATABASE_URL
- AUTH_SECRET
- AUTH_URL
- AUTH_TRUST_HOST=true
- NEXTAUTH_URL
- APP_URL
- NODE_ENV=production
- PORT=3000
- PLATFORM_SMTP_HOST
- PLATFORM_SMTP_PORT
- PLATFORM_SMTP_SECURE
- PLATFORM_SMTP_USER
- PLATFORM_SMTP_PASS
- PLATFORM_SMTP_FROM_NAME
- PLATFORM_SMTP_FROM_EMAIL

Important:
- Quote env values that contain spaces, for example `PLATFORM_SMTP_FROM_NAME="Wyndos Support"`.
- Set AUTH_URL, NEXTAUTH_URL, and APP_URL to the same public HTTPS origin.
- AUTH_TRUST_HOST=true is required behind Nginx.
- Invite and password-reset links still use NEXTAUTH_URL or APP_URL in app code.
- Configure PLATFORM_SMTP_* for platform emails such as super-admin password resets when tenant SMTP is not available.

## 4. Deploy app code

From the VPS:

```bash
cd /opt/wyndos/current
git fetch origin
git checkout main
git pull --ff-only origin main
sudo ./deploy/deploy-vps.sh
```

The deploy script performs the server-safe release steps:

- restores ownership to `wyndos:wyndos`
- links `/opt/wyndos/shared/.env.production` into the active release as `.env.production`
- clears the previous `.next` output
- runs dependency install, Prisma generate, Prisma migrate deploy, and `next build` as the `wyndos` user
- restarts `wyndos` and checks the local health endpoint

Do not build the release as `root`, and do not leave `/opt/wyndos/current` world-writable.

Optional one-time baseline path for a blank database:

```bash
npm run db:baseline:postgres > /tmp/postgres-baseline.sql
psql "$DATABASE_URL" -f /tmp/postgres-baseline.sql
```

Use the baseline SQL only for the first empty PostgreSQL deployment. After that, use `npm run db:migrate:deploy:postgres`.

## 5. Install systemd service

```bash
sudo cp deploy/systemd/wyndos.service /etc/systemd/system/wyndos.service
sudo systemctl daemon-reload
sudo systemctl enable wyndos
sudo systemctl start wyndos
sudo systemctl status wyndos --no-pager
```

## 6. Install Nginx site

```bash
sudo cp deploy/nginx/wyndos.conf /etc/nginx/sites-available/wyndos.conf
sudo ln -sf /etc/nginx/sites-available/wyndos.conf /etc/nginx/sites-enabled/wyndos.conf
sudo nginx -t
sudo systemctl reload nginx
```

Then add TLS with Certbot or your preferred certificate manager.

## 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 8. Rehearsal checks

Run these after deploy:

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i https://app.example.com/api/health
systemctl status wyndos --no-pager
journalctl -u wyndos -n 100 --no-pager
```

Expected health response:

```json
{
	"status":"ok",
	"database":"ok",
	"timestamp":"2026-03-26T12:00:00.000Z",
	"release": {
		"commit": "7c6f152f65492a17a7c9b245439384e09d294852",
		"builtAt": "2026-03-28T04:23:10Z"
	}
}
```

Manual smoke checks:
- Owner signup and onboarding lands on dashboard
- Cross-tenant customer URL returns 404
- Completing a day advances next due from completion date

## 9. Backup and rollback

Nightly PostgreSQL backup:

```bash
pg_dump "$DATABASE_URL" > /var/backups/wyndos-$(date +%F).sql
```

Rollback outline:
- Stop wyndos
- Restore previous release into /opt/wyndos/current
- Restore previous .env.production if needed
- If schema changed incompatibly, restore PostgreSQL from last known-good backup
- Start wyndos and re-check /api/health

## 10. Release workflow

Use this repository as the single source of truth:

1. Validate and commit locally.
2. Push to GitHub `main`.
3. Pull the exact commit on the VPS.
4. Run `sudo ./deploy/deploy-vps.sh`.
5. Verify `/api/health` locally and publicly.

## 11. Current verification note

This repository has been validated locally for:
- PostgreSQL schema generation and baseline SQL generation
- production build success
- production-shape smoke validation against next start

A live PostgreSQL migrate deploy run could not be executed on this Windows workstation because no local PostgreSQL server or Docker runtime is installed.