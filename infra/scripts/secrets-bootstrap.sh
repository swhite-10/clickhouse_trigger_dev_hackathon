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
# Not `op whoami`: it reports signed-out under the desktop-app integration
# even when every real operation works. Exercise the actual auth path.
op vault list >/dev/null 2>&1 || {
  echo "FAIL: op CLI can't reach an account — sign in via the 1Password app or: op signin"; exit 1; }

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

# Postgres (OLTP chat capture). Placeholder until a real instance exists —
# the template's DATABASE_URL line stays commented until then, so the
# placeholder is never used (capture is disabled when DATABASE_URL is unset).
ensure_item postgres \
  "url[password]=paste-postgres-connection-url"

# ClickHouse Cloud admin creds (default user) — used only by make ch-setup
# and make seed, never by the app (which runs as the readonly gh_pulse_ro).
# ro-password is a generated (not console-issued) credential: the password
# ch-setup.sh assigns to the new gh_pulse_ro user it creates. Lives here
# because it's a setup-time secret, not the app's runtime one — the app's
# clickhouse item only gets it copied over at actual cutover.
ensure_item clickhouse-admin \
  "url[text]=https://paste-cloud-host:8443" \
  "username[text]=default" \
  "password[password]=paste-from-cloud-console" \
  "ro-password[password]=paste-or-generate-a-random-value"

# ClickHouse Cloud API key (Admin role) — lets clickhousectl cloud manage
# services, including the Postgres service. Console -> API keys.
ensure_item clickhouse-cloud-api \
  "key[text]=paste-api-key-id" \
  "secret[password]=paste-api-key-secret"

# Langfuse appliance (infra/langfuse) — the one item whose secrets are all
# GENERATED here rather than pasted: headless init consumes them on first
# boot, so `make langfuse-up` works with zero UI steps. public/secret-key
# follow Langfuse's pk-lf-/sk-lf- convention; the rest are service passwords
# and crypto material the compose file interpolates.
ensure_item langfuse \
  "public-key[text]=pk-lf-$(uuidgen | tr '[:upper:]' '[:lower:]')" \
  "secret-key[password]=sk-lf-$(uuidgen | tr '[:upper:]' '[:lower:]')" \
  "user-email[text]=admin@gh-pulse.local" \
  "user-name[text]=admin" \
  "user-password[password]=$(openssl rand -hex 16)" \
  "salt[password]=$(openssl rand -hex 32)" \
  "encryption-key[password]=$(openssl rand -hex 32)" \
  "nextauth-secret[password]=$(openssl rand -hex 32)" \
  "postgres-password[password]=$(openssl rand -hex 16)" \
  "clickhouse-password[password]=$(openssl rand -hex 16)" \
  "redis-password[password]=$(openssl rand -hex 16)" \
  "minio-password[password]=$(openssl rand -hex 16)"

echo "==> verifying"
bash "$(dirname "$0")/secrets-check.sh" infra/env/.env.template
exec bash "$(dirname "$0")/secrets-check.sh" infra/langfuse/.env.template
