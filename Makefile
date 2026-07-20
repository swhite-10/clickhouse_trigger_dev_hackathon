# All secret-bearing commands run through the 1Password CLI (`op run`) —
# no .env files, no secrets on disk. See infra/env/.env.template.

ENV_FILE := infra/env/.env.template
OP_RUN   := op run --env-file=$(ENV_FILE) --

.PHONY: help install dev trigger-dev build secrets-bootstrap secrets-check pg-schema pg-schema-cloud ch-setup seed seed-recent

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install node dependencies
	npm install

dev: ## Nuxt dev server (localhost:3000) with secrets from 1Password
	$(OP_RUN) npx nuxt dev

trigger-dev: ## Run the chat agent locally against Trigger.dev cloud
	$(OP_RUN) npx trigger.dev@latest dev

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

seed-recent: ## Refresh the rolling 30-day window (run before the demo)
	$(OP_RUN) node infra/ch/seed.mjs --recent

secrets-bootstrap: ## One-time: create the 1Password vault + placeholder items
	bash infra/scripts/secrets-bootstrap.sh

secrets-check: ## Verify every op:// reference resolves (read-only)
	bash infra/scripts/secrets-check.sh $(ENV_FILE)
