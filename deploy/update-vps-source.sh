#!/usr/bin/env bash

set -euo pipefail

BRANCH="${1:-main}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_ROOT"

if [[ ! -d .git ]]; then
  echo "This script must run inside the Wyndos git repository."
  exit 1
fi

# Prisma client output is generated locally on the VPS during deploy and can
# leave tracked and untracked files dirty between releases. Clean only those
# generated directories before fast-forwarding the working tree.
git restore --source=HEAD --staged --worktree -- src/generated/prisma src/generated/prisma-postgres || true
git clean -fd -- src/generated/prisma src/generated/prisma-postgres || true

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
