# Staging (a private test copy of Wyndos)

Staging runs on the same VPS as production but is fully separate: its own folder
(`/opt/wyndos-staging`), database (`wyndos_staging`), service (`wyndos-staging`, port 3001)
and web address (`staging.wyndos.io`, password protected).

**Never copy real customer data into staging.** Use the demo data or make up test customers.

## One-time setup (on the VPS, as root)

1. DNS: add an `A` record `staging` → the VPS IP (same as `wyndos.io`).
2. Database: edit the password in `deploy/postgres/create-staging-db.sql`, then
   `sudo -u postgres psql -f deploy/postgres/create-staging-db.sql`
3. Code:
   ```bash
   git clone git@github-wyndos:tmcmahonnn92/wyndos.git /opt/wyndos-staging/current
   install -d -o wyndos -g wyndos /opt/wyndos-staging/shared /var/log/wyndos-staging
   ```
4. Settings: create `/opt/wyndos-staging/shared/.env.production` (owner `wyndos`, mode 600). Copy production's
   and change these:
   - `DATABASE_URL=postgresql://wyndos_staging:PASSWORD@127.0.0.1:5432/wyndos_staging?schema=public`
   - `APP_URL` and `NEXTAUTH_URL` = `https://staging.wyndos.io`
   - `AUTH_SECRET` = a new value (`openssl rand -base64 32`)
   - Stripe: **test** keys only, with a separate test webhook pointing at staging
   - `CRON_SECRET` = a new value; `MESSAGING_LIVE` unset
5. Service: `cp deploy/systemd/wyndos-staging.service /etc/systemd/system/ && systemctl enable wyndos-staging`
6. Web: 
   ```bash
   apt install apache2-utils
   htpasswd -c /etc/nginx/wyndos-staging.htpasswd tom
   cp deploy/nginx/wyndos-staging.conf /etc/nginx/sites-available/
   ln -s /etc/nginx/sites-available/wyndos-staging.conf /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   certbot --nginx -d staging.wyndos.io
   ```
7. First deploy: `cd /opt/wyndos-staging/current && sudo ./deploy/deploy-vps.sh --staging`

## Day to day

Test a branch on staging, then release it to production:

```bash
# 1. push your branch to GitHub, then on the VPS:
cd /opt/wyndos-staging/current
./deploy/update-vps-source.sh feature/whole-day
sudo ./deploy/deploy-vps.sh --staging
# 2. check it at https://staging.wyndos.io
# 3. happy? merge to main and deploy production as usual:
cd /opt/wyndos/current && ./deploy/update-vps-source.sh main && sudo ./deploy/deploy-vps.sh
```

Staging uses about 300–500 MB of RAM while running. Stop it when not testing:
`systemctl stop wyndos-staging`.
