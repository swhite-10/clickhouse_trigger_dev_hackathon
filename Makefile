# All secret-bearing commands run through the 1Password CLI (`op run`) —
# no .env files, no secrets on disk. See infra/env/.env.template.

ENV_FILE := infra/env/.env.template
OP_RUN   := op run --env-file=$(ENV_FILE) --

.PHONY: help install dev trigger-dev build warm secrets-bootstrap secrets-check pg-schema pg-schema-cloud ch-setup seed seed-recent langfuse-up langfuse-down

# Node 22+ prints ExperimentalWarnings for loaders nuxt/trigger rely on;
# silence just that class, keep every other warning.
export NODE_OPTIONS := --disable-warning=ExperimentalWarning

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install node dependencies
	npm install

dev: ## Nuxt dev server (localhost:3000) with secrets from 1Password
	$(OP_RUN) npx nuxt dev

# Not @latest: the CLI hard-aborts when its version drifts from the
# installed @trigger.dev/sdk, so run the locally-pinned CLI — npm keeps
# the two in lockstep in package.json (both pinned exact).
trigger-dev: ## Run the chat agent locally against Trigger.dev cloud
	$(OP_RUN) npx trigger.dev dev

build: ## Production build
	$(OP_RUN) npx nuxt build

# Local instance via clickhousectl (creds looked up, docker-exec fallback).
pg-schema: ## Apply the OLTP chat-capture schema to local Postgres (idempotent)
	clickhousectl local postgres client --queries-file infra/pg/schema.sql

# clickhousectl's explicit --host/--port mode doesn't reliably reach external
# (non-locally-managed) Postgres — falls straight to a throwaway postgres:18
# container instead, same mechanism the local instance already relies on.
pg-schema-cloud: ## Apply the OLTP chat-capture schema to Cloud Postgres (idempotent)
	docker run --rm -i postgres:18 psql "$$(op read op://gh-pulse/postgres/url)" < infra/pg/schema.sql

ch-setup: ## ClickHouse Cloud one-time: github_events schema + readonly role
	$(OP_RUN) bash infra/ch/cloud-setup.sh

seed: ## Stream the demo dataset playground -> ClickHouse Cloud (resumable)
	$(OP_RUN) node infra/ch/seed.mjs

seed-recent: ## Re-pull the last 3 days of global events (run before the demo)
	$(OP_RUN) node infra/ch/seed.mjs --recent

# Cloud idles after inactivity and the first query pays ~20s of resume
# (observed repeatedly in traces). Run this a minute before any demo.
warm: ## Wake ClickHouse Cloud so the first real query isn't slow
	@$(OP_RUN) sh -c 'time curl -sS -u "$$CLICKHOUSE_USER:$$CLICKHOUSE_PASSWORD" "$$CLICKHOUSE_URL" --data-binary "SELECT count() FROM github_events"'

# The one docker-compose exception (everything else via clickhousectl):
# Langfuse is an appliance of five services — web, worker, and its own
# ClickHouse, Redis, MinIO, Postgres. Secrets come from 1Password at start;
# `down` keeps the data volumes, so traces survive restarts.
langfuse-up: ## Start the Langfuse appliance (UI: http://localhost:3005)
	op run --env-file=infra/langfuse/.env.template -- docker compose -f infra/langfuse/docker-compose.yml up -d

langfuse-down: ## Stop the Langfuse appliance (data volumes persist)
	docker compose -f infra/langfuse/docker-compose.yml down

secrets-bootstrap: ## One-time: create the 1Password vault + placeholder items
	bash infra/scripts/secrets-bootstrap.sh

secrets-check: ## Verify every op:// reference resolves (read-only)
	bash infra/scripts/secrets-check.sh $(ENV_FILE)
	bash infra/scripts/secrets-check.sh infra/langfuse/.env.template
