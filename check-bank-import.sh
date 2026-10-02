#!/usr/bin/env bash
# Check the bank-import / legal / backups work safely on your PC.
# Uses a separate copy (../wyndos-check) and a copy of your local database,
# so your normal folder and data are not touched. Output also goes to check.log.
set -uo pipefail
MAIN="$HOME/wyndows_Stuff"
CHECK="$HOME/wyndos-check"
LOG="$MAIN/check.log"
exec > >(tee "$LOG") 2>&1
step() { echo; echo "=== $* ==="; }
fail() { echo; echo "FAILED: $*"; echo "Send Claude the end of $LOG"; exit 1; }

cd "$MAIN" || fail "no $MAIN"

step "1. Get the new commits into a separate branch (bank-import)"
git fetch ./bank-import.bundle feature/whole-day:bank-import 2>/dev/null \
  || git rev-parse --verify -q bank-import >/dev/null \
  || fail "couldn't read bank-import.bundle"
git log --oneline -3 bank-import

step "2. Make a separate working copy at $CHECK"
if [[ -d "$CHECK" ]]; then git worktree remove --force "$CHECK" 2>/dev/null || rm -rf "$CHECK"; git worktree prune; fi
git worktree add -q "$CHECK" bank-import || fail "worktree"
cd "$CHECK"
[[ -f "$MAIN/.env" ]] && cp "$MAIN/.env" .env
[[ -f "$MAIN/.env.local" ]] && cp "$MAIN/.env.local" .env.local

step "3. Copy your local database (the original is not changed)"
SRC="$(grep -h '^DATABASE_URL=' "$MAIN/.env" "$MAIN/.env.local" 2>/dev/null | tail -1 | sed -E 's/^DATABASE_URL="?file:(\.\/)?([^"]*)"?$/\2/')"
for f in "$SRC" demo.db dev.db; do
  if [[ -n "$f" && -f "$MAIN/$f" ]]; then cp "$MAIN/$f" check.db; echo "copied $f"; break; fi
done
[[ -f check.db ]] || echo "no local database found, a fresh one will be made"
export DATABASE_URL="file:./check.db"
printf 'DATABASE_URL="file:./check.db"\n' >> .env.local

step "4. Install and generate Prisma clients"
npm ci --legacy-peer-deps --no-audit --no-fund || fail "npm install / prisma generate"

step "5. Apply the new migrations to the copy"
if ! npx prisma migrate deploy; then
  echo "migrate deploy refused (database not tracked by migrations); applying the 2 new ones directly"
  node -e '
    const db = require("better-sqlite3")("check.db");
    const fs = require("fs");
    for (const m of ["20261002160000_bank_import", "20261002161000_terms_acceptance"]) {
      try { db.exec(fs.readFileSync(`prisma/migrations/${m}/migration.sql`, "utf8")); console.log("applied", m); }
      catch (e) { if (/already exists|duplicate column/.test(e.message)) console.log("already there", m); else { console.error(e.message); process.exit(1); } }
    }' || fail "migrations"
fi

step "6. Type check"
npx tsc --noEmit -p . || fail "type check"

step "7. Production build"
npx next build --webpack || fail "build"

step "ALL CHECKS PASSED"
echo "To try it:  cd $CHECK && npx next start -p 3100   then open http://localhost:3100/payments/import"
echo "Your normal folder and database were not changed. Remove the copy later with:"
echo "  cd $MAIN && git worktree remove --force $CHECK"
