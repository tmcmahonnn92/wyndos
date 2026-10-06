#!/usr/bin/env bash
#
# Deploy Wyndos with no downtime.
#
#   /opt/wyndos/current     the git checkout (the dashboard pulls into it; nothing runs from here)
#   /opt/wyndos/releases/*  one built copy per deploy (the last few are kept)
#   /opt/wyndos/live        symlink to the release that's running
#   wyndos@3000, wyndos@3002  two copies of the app; nginx sends traffic to whichever is up
#
# The new version is built in its own folder while the old one keeps serving. Then the two
# copies are restarted one at a time, each only after the other is healthy, so visitors never
# hit a dead server. If the new build fails, or doesn't come up healthy, nothing changes live.
#
# Staging: sudo ./deploy/deploy-vps.sh --staging (ports 3001 and 3003).

set -euo pipefail

APP_USER="wyndos"
APP_GROUP="wyndos"
APP_NAME="wyndos"
APP_ROOT="/opt/wyndos"
LOG_DIR="/var/log/wyndos"
PORTS=(3000 3002)

if [[ "${1:-}" == "--staging" ]]; then
  APP_NAME="wyndos-staging"
  APP_ROOT="/opt/wyndos-staging"
  LOG_DIR="/var/log/wyndos-staging"
  PORTS=(3001 3003)
fi

SRC_DIR="$APP_ROOT/current"
RELEASES_DIR="$APP_ROOT/releases"
LIVE_LINK="$APP_ROOT/live"
SHARED_DIR="$APP_ROOT/shared"
ENV_FILE="$SHARED_DIR/.env.production"
STATIC_DIR="$SHARED_DIR/next-static"
KEEP_RELEASES=3

log() { printf '\n== %s\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root or via sudo."
  exit 1
fi
[[ -d "$SRC_DIR/.git" ]] || { echo "Missing source checkout: $SRC_DIR"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Missing production env file: $ENV_FILE"; exit 1; }

install -d -o "$APP_USER" -g "$APP_GROUP" -m 755 "$APP_ROOT" "$SHARED_DIR" "$LOG_DIR" "$RELEASES_DIR" "$STATIC_DIR"
chmod 640 "$ENV_FILE" && chown "root:$APP_GROUP" "$ENV_FILE" || true

COMMIT="$(git -C "$SRC_DIR" rev-parse HEAD)"
STAMP="$(date -u +%Y%m%d%H%M%S)"
RELEASE="$RELEASES_DIR/$STAMP-${COMMIT:0:7}"
PREVIOUS="$(readlink -f "$LIVE_LINK" 2>/dev/null || true)"

# ── 1. Copy the source into a fresh release folder ────────────────────────────
log "New release $RELEASE"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 755 "$RELEASE"
tar -C "$SRC_DIR" --exclude=./.git --exclude=./node_modules --exclude=./.next --exclude='./.env*' \
  --exclude=./src/generated -cf - . | tar -C "$RELEASE" -xf -
ln -sfn "$ENV_FILE" "$RELEASE/.env.production"
printf '{\n  "commit": "%s",\n  "builtAt": "%s"\n}\n' "$COMMIT" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$RELEASE/.release-meta.json"
chown -R "$APP_USER:$APP_GROUP" "$RELEASE"

in_release() {
  runuser -u "$APP_USER" -- bash -lc "set -a; source '$ENV_FILE'; set +a; cd '$RELEASE' && $*"
}

# ── 2. Install, migrate, build (the live site keeps running throughout) ──────
cleanup_failed() {
  echo "Deploy failed before going live. The site is unchanged."
  rm -rf "$RELEASE"
}
trap cleanup_failed ERR
log "Installing packages"
in_release "npm ci --include=dev --legacy-peer-deps"
log "Prisma"
in_release "npm run db:generate && npm run db:generate:postgres"
log "Database changes"
in_release "npm run db:migrate:deploy:postgres"
log "Building"
in_release "npm run build"
trap - ERR

# Keep every build's static files, so a page still open from the last version can load its
# scripts while it's being refreshed. nginx serves /_next/static from here.
cp -a "$RELEASE/.next/static/." "$STATIC_DIR/"
chown -R "$APP_USER:$APP_GROUP" "$STATIC_DIR"
find "$STATIC_DIR" -type f -mtime +30 -delete 2>/dev/null || true

# ── 3. Services (installed or updated from the repo) ──────────────────────────
TEMPLATE="$RELEASE/deploy/systemd/$APP_NAME@.service"
if [[ -f "$TEMPLATE" ]] && ! cmp -s "$TEMPLATE" "/etc/systemd/system/$APP_NAME@.service"; then
  log "Installing $APP_NAME@.service"
  install -m 644 "$TEMPLATE" "/etc/systemd/system/$APP_NAME@.service"
  systemctl daemon-reload
fi

# ── 4. Go live: point at the new release, restart one copy at a time ─────────
log "Switching to the new release"
ln -sfn "$RELEASE" "$LIVE_LINK.tmp" && mv -Tf "$LIVE_LINK.tmp" "$LIVE_LINK"

healthy() {
  local port="$1"
  for _ in $(seq 1 60); do
    curl --fail --silent --max-time 3 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

rollback() {
  local port="$1"
  echo "Port $port didn't come up healthy on the new release."
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    echo "Going back to $PREVIOUS"
    ln -sfn "$PREVIOUS" "$LIVE_LINK.tmp" && mv -Tf "$LIVE_LINK.tmp" "$LIVE_LINK"
    systemctl restart "$APP_NAME@$port" || true
  fi
  journalctl -u "$APP_NAME@$port" -n 60 --no-pager || true
  exit 1
}

# Restart the second copy first: on the very first run it isn't running yet, so the old
# single service keeps serving on the first port until the new copy is up.
for (( i=${#PORTS[@]}-1; i>=0; i-- )); do
  port="${PORTS[$i]}"
  if [[ "$port" == "${PORTS[0]}" ]] && systemctl is-active --quiet "$APP_NAME.service"; then
    # One-off move from the old single service (it ran on this port).
    log "Retiring the old $APP_NAME.service"
    systemctl disable --now "$APP_NAME.service"
  fi
  log "Restarting $APP_NAME@$port"
  systemctl enable "$APP_NAME@$port" >/dev/null 2>&1 || true
  systemctl restart "$APP_NAME@$port"
  healthy "$port" || rollback "$port"
  echo "Port $port is healthy."
done

# ── 5. Tidy up: keep the newest few releases (always the live one) ────────────
LIVE_NOW="$(readlink -f "$LIVE_LINK")"
mapfile -t OLD < <(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | sed 's:/$::' | tail -n +$((KEEP_RELEASES + 1)))
for dir in "${OLD[@]}"; do
  [[ "$(readlink -f "$dir")" == "$LIVE_NOW" ]] && continue
  rm -rf "$dir"
done

log "Live: $COMMIT"
curl --fail --silent --show-error "http://127.0.0.1:${PORTS[0]}/api/health"
echo
