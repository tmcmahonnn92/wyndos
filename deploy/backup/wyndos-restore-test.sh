#!/usr/bin/env bash
# Prove the newest backup can be restored: decrypt it into a throwaway database,
# count the rows in a few tables, then drop it. Run monthly (or after changing backups).
#   sudo ./deploy/backup/wyndos-restore-test.sh [path/to/backup.dump.enc]
set -euo pipefail
umask 077
CONF=/etc/wyndos/backup.conf
[[ -f "$CONF" ]] && source "$CONF"
KEY_FILE="${KEY_FILE:-/etc/wyndos/backup.key}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wyndos}"
FILE="${1:-$(ls -1t "$BACKUP_DIR"/hourly/*.dump.enc | head -n 1)}"
DB=wyndos_restore_test
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT

echo "Testing $FILE"
[[ -f "$FILE.sha256" ]] && sha256sum -c "$FILE.sha256"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" -in "$FILE" -out "$TMP/db.dump"
chmod 644 "$TMP/db.dump"; chmod 755 "$TMP"
sudo -u postgres dropdb --if-exists "$DB"
sudo -u postgres createdb "$DB"
sudo -u postgres pg_restore --no-owner --dbname="$DB" "$TMP/db.dump"
for t in Tenant Customer Job Payment; do
  printf '%-10s %s rows\n' "$t" "$(sudo -u postgres psql -At -d "$DB" -c "SELECT count(*) FROM \"$t\"")"
done
echo "Restore test passed. Throwaway database removed."
