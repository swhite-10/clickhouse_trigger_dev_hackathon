#!/usr/bin/env bash
# One-time bootstrap of the 1Password vault + items this project needs.
# Idempotent and strictly additive: existing vaults and items are never
# edited or overwritten, so re-running can't rotate a value out from under
# a running service. Rotation stays a deliberate manual act.
#
# Adding a secret later: add an ensure_item line below AND the matching
# op:// reference in infra/env/.env.template, then re-run this script.
set -euo pipefail

VAULT="gh-pulse"

command -v op >/dev/null 2>&1 || {
  echo "FAIL: op CLI not installed — https://developer.1password.com/docs/cli/"; exit 1; }
op whoami >/dev/null 2>&1 || {
  echo "FAIL: not signed in — run: op signin"; exit 1; }

# Vault: create if missing; refuse to guess if the name is ambiguous.
count=$(op vault list --format=json | grep -c "\"name\": \"$VAULT\"") || true
case "$count" in
  0) echo "==> creating vault '$VAULT'"
     op vault create "$VAULT" --description "gh-pulse hackathon — see infra/env/.env.template" >/dev/null ;;
  1) echo "==> vault '$VAULT' exists" ;;
  *) echo "==> $count vaults named '$VAULT' — references would be ambiguous; delete the extras first"
     exit 1 ;;
esac

# ensure_item TITLE field=value...  Creates the item only if absent; an
# existing item is left untouched even if fields are missing (secrets-check
# flags those — fix by hand with `op item edit`).
ensure_item() {
  local title="$1"; shift
  if op item get "$title" --vault "$VAULT" >/dev/null 2>&1; then
    echo "  exists   $title — left untouched"
  else
    op item create --vault "$VAULT" --category password --title "$title" "$@" >/dev/null
    echo "  created  $title"
  fi
}

echo "==> items"

# All three items hold externally issued values, so the bootstrap seeds
# placeholders (or working playground defaults) rather than generating.
ensure_item trigger \
  "secret-key[password]=paste-tr_dev_key-from-dashboard" \
  "project-ref[text]=paste-proj_ref-from-dashboard"

ensure_item anthropic \
  "api-key[password]=paste-sk-ant-key-from-console"

# Playground defaults keep `op run` working before ClickHouse Cloud data
# lands; the password field is a placeholder because the template's
# CLICKHOUSE_PASSWORD stays literal-empty until the Cloud switch (see the
# template header for the exact edit).
ensure_item clickhouse \
  "url[text]=https://play.clickhouse.com" \
  "username[text]=play" \
  "password[password]=paste-from-clickhouse-cloud-console"

echo "==> verifying"
exec bash "$(dirname "$0")/secrets-check.sh"
