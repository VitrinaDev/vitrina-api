#!/usr/bin/env bash
# Copy packages/api-sdk + the published spec out of vitrina-app into this mirror.
#
# The monorepo is the source of truth: the SDK is generated there from
# `openapi.public.json`, which is itself generated from the route definitions.
# This repository exists only so npm will attest provenance (it refuses to for a
# private source), so it must never become a second place to edit the SDK.
set -euo pipefail

MONOREPO="${1:-$HOME/me/vitrina/web/vitrina-app}"
REF="${2:-origin/develop}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -d "$MONOREPO/.git" ] || { echo "not a git repo: $MONOREPO" >&2; exit 1; }
git -C "$MONOREPO" fetch origin --quiet

# Everything the package owns, replaced wholesale — a file deleted upstream has
# to disappear here too, which a copy-over-the-top would silently keep.
rm -rf "$HERE/src" "$HERE/test"
git -C "$MONOREPO" archive "$REF" packages/api-sdk \
  | tar -x -C "$HERE" --strip-components=2
git -C "$MONOREPO" show "$REF:openapi.public.json" > "$HERE/openapi.public.json"

# The generated types are NOT committed upstream and cannot be produced here:
# the generators resolve ../../../ to the MONOREPO root for openapi.public.json
# and src/errors/index.ts, neither of which exists beside a standalone repo.
#
# Generated from a DISPOSABLE WORKTREE at $REF rather than from $MONOREPO
# directly, for two reasons. The checkout on a given machine may be a BARE repo
# with no working tree at all (it is on the box this was written on), and even
# when it is not, its working tree is whatever branch someone left it on —
# which is how a stale tree once convinced me a package did not exist and cost
# a day rebuilding it. A worktree at an explicit ref cannot lie about that.
TMP_WT="$(mktemp -d)/sdk-gen"
git -C "$MONOREPO" worktree add --detach "$TMP_WT" "$REF" >/dev/null
trap 'git -C "$MONOREPO" worktree remove --force "$TMP_WT" >/dev/null 2>&1 || true' EXIT
( cd "$TMP_WT/packages/api-sdk" && pnpm install --prefer-offline >/dev/null && pnpm run generate >/dev/null )
mkdir -p "$HERE/src/generated"
cp "$TMP_WT"/packages/api-sdk/src/generated/*.ts "$HERE/src/generated/"

# The mirror's own identity, which the monorepo copy does not carry.
node -e '
  const fs = require("fs"), p = process.argv[1];
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  d.repository = { type: "git", url: "git+https://github.com/VitrinaDev/vitrina-api.git" };
  d.bugs = { url: "https://github.com/VitrinaDev/vitrina-api/issues" };
  d.publishConfig = { access: "public", provenance: true };
  for (const k of ["generate", "prebuild", "pretest"]) delete d.scripts[k];
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
' "$HERE/package.json"

# Refuse to leave a credential-shaped string in a PUBLIC repository. The three
# live clinic tokens that reached docs.vitrinadev.com in Sept 2026 travelled
# exactly this path: example → spec → generated types → published artifact.
if grep -rqE 'eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16,}' "$HERE/src" "$HERE/openapi.public.json"; then
  echo "REFUSING TO SYNC: a JWT-shaped string is present. Examples must say <token>." >&2
  exit 1
fi

echo "synced from $REF — review 'git diff', bump the version, tag vX.Y.Z"
