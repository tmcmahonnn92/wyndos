#!/usr/bin/env bash
# Hourly encrypted backup of the Wyndos production database, copied off the server.
#
#   - pg_dump (custom format) of DATABASE_URL from the production env file
#   - checked with pg_restore --list, so a broken dump is never kept as "good"
#   - encrypted with AES-256 using /etc/wyndos/backup.key (keep a copy of that key
#     in your password manager: without it the backups can't be opened)
#   - kept locally: 48 hourly + 14 daily
#   - copied off the server with rclone (BACKUP_REMOTE, e.g. "r2:wyndos-backups")
#     and removed there after 35 days (matches the Terms)
#   - once a day the env file (secrets) is backed up too, encrypted the same way
#   - optional: BACKUP_PING_URL (e.g. healthchecks.io) is pinged on success / failure
#
# Settings live in /etc/wyndos/backup.conf (see deploy/BACKUPS.md).

set -euo pipefail
umask 077

CONF=/etc/wyndos/backup.conf
[[ -f "$CONF" ]] && source "$CONF"

ENV_FILE="${ENV_FILE:-/opt/wyndos/shared/.env.production}"
KEY_FILE="${KEY_FILE:-/etc/wyndos/backup.key}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wyndos}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
REMOTE_KEEP="${REMOTE_KEEP:-35d}"
BACKUP_PING_URL="${BACKUP_PING_URL:-}"

ping_url() { [[ -n "$BACKUP_PING_URL" ]] && curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL$1" >/dev/null 2>&1 || true; }
fail() { echo "[wyndos-backup] FAILED: $*" >&2; ping_url "/fail"; exit 1; }
trap 'fail "line $LINENO"' ERR

[[ -f "$ENV_FILE" ]] || fail "missing $ENV_FILE"
[[ -s "$KEY_FILE" ]] || fail "missing $KEY_FILE (create it: openssl rand -base64 48 > $KEY_FILE)"

DATABASE_URL="$(set -a; source "$ENV_FILE"; echo "${DATABASE_URL:-}")"
[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL not set in $ENV_FILE"
# Prisma adds ?schema=public, which pg_dump doesn't understand.
PG_URL="${DATABASE_URL%%\?*}"

STAMP="$(date -u +%Y%m%d-%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
install -d -m 700 "$BACKUP_DIR/hourly" "$BACKUP_DIR/daily"

pg_dump --format=custom --no-owner --no-privileges --compress=6 --file="$TMP/db.dump" "$PG_URL"
pg_restore --list "$TMP/db.dump" >/dev/null   # proves the dump can be read back

OUT="$BACKUP_DIR/hourly/wyndos-$STAMP.dump.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" -in "$TMP/db.dump" -out "$OUT"
sha256sum "$OUT" > "$OUT.sha256"

# First backup of the day is also kept as the daily one, with the env file.
DAY="$(date -u +%Y%m%d)"
if ! ls "$BACKUP_DIR/daily/wyndos-$DAY"* >/dev/null 2>&1; then
  cp "$OUT" "$BACKUP_DIR/daily/wyndos-$DAY.dump.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" -in "$ENV_FILE" -out "$BACKUP_DIR/daily/wyndos-$DAY.env.enc"
fi

# Local rotation: newest 48 hourly, newest 14 days.
ls -1t "$BACKUP_DIR"/hourly/*.dump.enc 2>/dev/null | tail -n +49 | while read -r f; do rm -f "$f" "$f.sha256"; done
find "$BACKUP_DIR/daily" -type f -mtime +14 -delete

# Off-site copy.
if [[ -n "$BACKUP_REMOTE" ]]; then
  rclone copy "$OUT" "$BACKUP_REMOTE/hourly/" --quiet
  rclone copy "$BACKUP_DIR/daily" "$BACKUP_REMOTE/daily/" --quiet
  rclone delete "$BACKUP_REMOTE" --min-age "$REMOTE_KEEP" --quiet
else
  echo "[wyndos-backup] WARNING: BACKUP_REMOTE not set, backup is only on this server." >&2
fi

echo "[wyndos-backup] ok $OUT ($(du -h "$OUT" | cut -f1))"
ping_url ""
