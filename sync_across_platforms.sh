#!/usr/bin/env bash
set -euo pipefail

# -------------------------------------------------------------------
# sync_across_platforms.sh – keep the repo in sync across OSes
# -------------------------------------------------------------------
# Usage: ./sync_across_platforms.sh [branch]
#   If no branch is supplied, the current HEAD branch is used.
# -------------------------------------------------------------------

# Determine branch
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

# Ensure we are on the correct branch
git checkout "$BRANCH"

# Fetch remote updates (all remotes)
git fetch --all --prune

# Rebase onto the upstream main (or upstream/<branch> if it exists)
UPSTREAM="origin/main"
if git rev-parse --verify "origin/$BRANCH" > /dev/null 2>&1; then
  UPSTREAM="origin/$BRANCH"
fi

echo "Rebasing $BRANCH onto $UPSTREAM..."
if ! git rebase "$UPSTREAM"; then
  echo "⚠️ Rebase conflict detected. Resolve manually, then run:"
  echo "   git rebase --continue"
  exit 1
fi

# Run lint / format checks (optional – add your own commands here)
# Example: ruff check . && ruff format .

# Push the rebased branch
git push origin "$BRANCH" --force-with-lease

echo "✅ Synchronisation complete for $BRANCH"
