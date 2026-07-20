#!/usr/bin/env bash
# Verify 1Password is usable and every op:// reference in the env template
# resolves. Read-only by construction: never creates or edits vault content.
#
# Run directly, NOT under `op run` — a broken reference makes `op run` abort
# before any script inside it could report which reference is broken.
set -uo pipefail

TEMPLATE="${1:-infra/env/.env.template}"
FAIL=0

echo "==> 1Password"

if ! command -v op >/dev/null 2>&1; then
  echo "  FAIL  op CLI not installed — https://developer.1password.com/docs/cli/"
  exit 1
fi

# Not `op whoami`: it reports signed-out under the desktop-app integration
# even when every real operation works. Exercise the actual auth path.
if ! op vault list >/dev/null 2>&1; then
  echo "  FAIL  op CLI can't reach an account — sign in via the 1Password app or: op signin"
  exit 1
fi
echo "  OK    signed in"

# Active (uncommented) references only — commented ones are queued-up future
# secrets and expected not to resolve yet.
refs=$(grep -E '^[A-Za-z_]+=op://' "$TEMPLATE" | cut -d= -f2-)
if [ -z "$refs" ]; then
  echo "  FAIL  no op:// references found in $TEMPLATE"
  exit 1
fi

# Vault names must exist exactly once — 1Password allows duplicate vault
# names, and a duplicate makes every reference into it ambiguous.
for vault in $(printf '%s\n' "$refs" | cut -d/ -f3 | sort -u); do
  count=$(op vault list --format=json 2>/dev/null | grep -c "\"name\": \"$vault\"")
  case "$count" in
    1) echo "  OK    vault '$vault' exists" ;;
    0) echo "  FAIL  vault '$vault' missing — run: make secrets-bootstrap"
       FAIL=1 ;;
    *) echo "  FAIL  $count vaults named '$vault' — references are ambiguous, delete the extras"
       FAIL=1 ;;
  esac
done

echo "==> Secret references ($TEMPLATE)"
while IFS= read -r ref; do
  if op read "$ref" >/dev/null 2>&1; then
    echo "  OK    $ref"
  else
    echo "  FAIL  $ref — create the item/field (see $TEMPLATE header)"
    FAIL=1
  fi
done <<< "$refs"

if [ "$FAIL" -ne 0 ]; then
  echo "==> Secrets not ready — fix the FAIL lines above, then re-run: make secrets-check"
  exit 1
fi
echo "==> All secret references resolve"
