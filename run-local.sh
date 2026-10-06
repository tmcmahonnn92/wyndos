#!/bin/bash
# Run Wyndos on this computer: http://localhost:3000 (uses .env and dev.db in this folder).
set -e
cd "$(dirname "$0")"
echo "== Installing packages"
npm install
echo "== Updating the local database"
npx prisma migrate deploy || {
  echo "== migrate deploy didn't apply (database was set up another way); syncing it instead"
  npx prisma db push
}
echo "== Starting on http://localhost:3000 (Ctrl+C to stop)"
npm run dev
