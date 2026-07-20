#!/usr/bin/env bash
# One-time ClickHouse Cloud setup: github_events schema + the readonly role
# the app connects with. Idempotent. Run via: make ch-setup
#
# The query limits the playground enforced server-side (and the app was built
# against) move into the gh_pulse_ro settings profile here — the agent's SQL
# guard stays the first line of defense, this profile is the backstop.
set -euo pipefail

: "${CLICKHOUSE_ADMIN_URL:?set via op run (see infra/env/.env.template)}"
: "${CLICKHOUSE_ADMIN_USER:?}"
: "${CLICKHOUSE_ADMIN_PASSWORD:?}"
: "${CLICKHOUSE_RO_PASSWORD:?the gh_pulse_ro password — stored on clickhouse-admin/ro-password}"

q() {
  curl -sS --fail-with-body "$CLICKHOUSE_ADMIN_URL" \
    -u "$CLICKHOUSE_ADMIN_USER:$CLICKHOUSE_ADMIN_PASSWORD" \
    --data-binary "$1"
}

echo "==> schema"
q "$(cat "$(dirname "$0")/schema.sql")"

echo "==> readonly profile + user"
q "CREATE SETTINGS PROFILE IF NOT EXISTS gh_pulse_ro SETTINGS
     readonly = 1,
     max_execution_time = 30,
     max_result_rows = 10000,
     max_result_bytes = 100000000,
     max_memory_usage = 10000000000"
q "CREATE USER IF NOT EXISTS gh_pulse_ro IDENTIFIED BY '${CLICKHOUSE_RO_PASSWORD}' SETTINGS PROFILE 'gh_pulse_ro'"
q "GRANT SELECT ON default.github_events TO gh_pulse_ro"

echo "==> verify: readonly user can select, cannot write"
ro_count=$(curl -sS --fail-with-body "$CLICKHOUSE_ADMIN_URL" -u "gh_pulse_ro:${CLICKHOUSE_RO_PASSWORD}" \
  --data-binary 'SELECT count() FROM default.github_events')
echo "    github_events rows visible to gh_pulse_ro: $ro_count"
if curl -sS "$CLICKHOUSE_ADMIN_URL" -u "gh_pulse_ro:${CLICKHOUSE_RO_PASSWORD}" \
  --data-binary 'CREATE TABLE default.should_fail (x UInt8) ENGINE = MergeTree ORDER BY x' 2>&1 | grep -q Exception; then
  echo "    write correctly rejected"
else
  echo "FAIL: readonly user was able to run DDL"; exit 1
fi
echo "OK"
