# Release Workflow

This is the intended deployment path for Wyndos.

## Source of truth

- Local repository: prepare and validate the change.
- GitHub `main`: the release source for the VPS.
- VPS `/opt/wyndos/current`: pull the exact commit from GitHub, then rebuild locally on the server.

Do not maintain ad hoc file copies or tarball-only releases as the primary deploy path.

## Standard release flow

From the local repository:

```bash
git status
npm run build
git add .
git commit -m "Describe the release"
git push origin main
```

From the VPS:

```bash
cd /opt/wyndos/current
./deploy/update-vps-source.sh main
sudo ./deploy/deploy-vps.sh
```

`deploy/update-vps-source.sh` cleans generated Prisma client output before the fast-forward pull, which prevents VPS deploys from getting stuck on locally generated changes under `src/generated/prisma*`.

## What the VPS deploy script does

- fixes release ownership back to `wyndos:wyndos`
- links `/opt/wyndos/shared/.env.production` into the active release as `.env.production`
- writes `.release-meta.json` with the deployed commit SHA and build timestamp
- removes the previous `.next` build output
- runs `npm ci --legacy-peer-deps`
- runs Prisma generate and migrate deploy for PostgreSQL
- runs `next build` as the `wyndos` user
- restarts the `wyndos` systemd service
- checks `http://127.0.0.1:3000/api/health`

## If a pull was already blocked

Run this from the VPS release directory:

```bash
cd /opt/wyndos/current
./deploy/update-vps-source.sh main
sudo ./deploy/deploy-vps.sh
```

## Operational rules

- Build on the VPS as the `wyndos` user, not as `root`.
- Keep `/opt/wyndos/current` owned by `wyndos:wyndos` and mode `755`, not world-writable.
- Keep environment configuration in `/opt/wyndos/shared/.env.production`.
- If an env value contains spaces, quote it, for example:

```bash
PLATFORM_SMTP_FROM_NAME="Wyndos Support"
```

- Do not rely on an existing `.next` directory surviving across releases.

## Verification after each release

```bash
systemctl status wyndos --no-pager -l
curl -i http://127.0.0.1:3000/api/health
curl -i https://wyndos.io/api/health
journalctl -u wyndos -n 100 --no-pager
```

The health endpoint should now include:

```json
{
	"status": "ok",
	"database": "ok",
	"timestamp": "2026-03-28T04:23:38.672Z",
	"release": {
		"commit": "7c6f152f65492a17a7c9b245439384e09d294852",
		"builtAt": "2026-03-28T04:23:10Z"
	}
}
```

## Recovery note

If the site returns `502 Bad Gateway` again, check these first:

1. `systemctl status wyndos --no-pager -l`
2. `tail -n 100 /var/log/wyndos/app-error.log`
3. `ls -la /opt/wyndos/current/.next`
4. `ls -ld /opt/wyndos/current`