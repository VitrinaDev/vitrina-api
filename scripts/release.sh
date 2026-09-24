#!/usr/bin/env bash
# One command, run right after a platform release tag exists:
#
#     ./scripts/release.sh v11.6.0
#
# Syncs from that exact release commit, bumps to the same number, commits,
# tags and pushes. The tag push is what triggers publish.yml.
#
# WHY IT IS ONE COMMAND. `vitrina-app` no longer publishes the SDK — the mirror
# is the only path — so between a platform tag and this tag there is a window
# where a release exists with no matching package. The docs now describe that
# gap honestly rather than hiding it, but the right size for it is minutes.
set -euo pipefail

TAG="${1:?usage: release.sh vX.Y.Z}"
VERSION="${TAG#v}"
MONOREPO="${2:-$HOME/me/vitrina/web/vitrina-app}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a release version: $VERSION" >&2; exit 1; }

# The tag has to exist upstream. Syncing from `develop` would ship whatever has
# landed since the release was cut, and the version number would then be a lie.
git -C "$MONOREPO" fetch origin --tags --quiet
git -C "$MONOREPO" rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null \
  || { echo "no such tag in vitrina-app: $TAG" >&2; exit 1; }

# Refuse to republish. npm answers 403/409 and the workflow would go red for a
# reason that reads like a credentials problem.
if npm view "@vitrina/api@$VERSION" version >/dev/null 2>&1; then
  echo "@vitrina/api@$VERSION is already published — nothing to do" >&2
  exit 1
fi

./scripts/sync-from-monorepo.sh "$MONOREPO" "$TAG"

node -e '
  const fs = require("fs"), p = "package.json";
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  d.version = process.argv[1];
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
' "$VERSION"

pnpm install --prefer-offline >/dev/null
pnpm run typecheck
pnpm run build
pnpm run test

# Last line of defence before a PUBLIC tag. The sync script checks the spec and
# src; this checks everything, including what the build just emitted — plus,
# since 2026-09-24, payment-card (Luhn), Chilean RUT (mod-11) and IBAN (mod-97)
# shapes that actually validate, not just look card/RUT/IBAN-shaped. See
# scripts/security-sweep.ts for what each detector does, why a deliberate
# placeholder can't trip it, and the guard-script self-exemption it carries
# forward from this same check (this file and sync-from-monorepo.sh, plus
# security-sweep.ts itself — see its GUARDS constant).
node scripts/security-sweep.ts

git add -A
git commit -m "release: $VERSION

Synced from vitrina-app $TAG. The version is the platform release this SDK
describes; see that release's notes for what changed in the contract."
git tag "$TAG"
git push origin main "$TAG"

echo
echo "pushed $TAG — publish.yml is running:"
echo "  gh run watch -R VitrinaDev/vitrina-api"
echo "then verify provenance:"
echo "  npm view @vitrina/api@$VERSION"
