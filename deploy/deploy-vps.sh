#!/usr/bin/env bash

set -euo pipefail

APP_USER="wyndos"
APP_GROUP="wyndos"
APP_SERVICE="wyndos"
RELEASE_DIR="/opt/wyndos/current"
SHARED_DIR="/opt/wyndos/shared"
ENV_FILE="$SHARED_DIR/.env.production"
LOG_DIR="/var/log/wyndos"
RELEASE_META_FILE="$RELEASE_DIR/.release-meta.json"

run_as_app() {
  runuser -u "$APP_USER" -- bash -lc "cd '$RELEASE_DIR' && $*"
}

run_as_app_with_env() {
  runuser -u "$APP_USER" -- bash -lc "set -a; source '$ENV_FILE'; set +a; cd '$RELEASE_DIR' && $*"
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root or via sudo."
  exit 1
fi

if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "Missing release directory: $RELEASE_DIR"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production env file: $ENV_FILE"
  exit 1
fi

install -d -o "$APP_USER" -g "$APP_GROUP" -m 755 /opt/wyndos "$SHARED_DIR" "$LOG_DIR"
chown -R "$APP_USER:$APP_GROUP" "$RELEASE_DIR"
chmod 755 "$RELEASE_DIR"

ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env.production"
chown -h "$APP_USER:$APP_GROUP" "$RELEASE_DIR/.env.production" || true

printf '{\n  "commit": "%s",\n  "builtAt": "%s"\n}\n' "$(git -C "$RELEASE_DIR" rev-parse HEAD)" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$RELEASE_META_FILE"
chown "$APP_USER:$APP_GROUP" "$RELEASE_META_FILE"

rm -rf "$RELEASE_DIR/.next"

run_as_app "npm ci --include=dev --legacy-peer-deps"
run_as_app_with_env "npm run db:generate"
run_as_app_with_env "npm run db:generate:postgres"
run_as_app_with_env "npm run db:migrate:deploy:postgres"
run_as_app_with_env "npm run build"

systemctl daemon-reload
systemctl restart "$APP_SERVICE"
sleep 5

systemctl status "$APP_SERVICE" --no-pager -l
curl --fail --silent --show-error http://127.0.0.1:3000/api/health