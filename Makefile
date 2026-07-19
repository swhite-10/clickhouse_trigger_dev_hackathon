# All secret-bearing commands run through the 1Password CLI (`op run`) —
# no .env files, no secrets on disk. See infra/env/.env.template.

ENV_FILE := infra/env/.env.template
OP_RUN   := op run --env-file=$(ENV_FILE) --

.PHONY: help install dev trigger-dev build secrets-bootstrap secrets-check

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

secrets-bootstrap: ## One-time: create the 1Password vault + placeholder items
	bash infra/scripts/secrets-bootstrap.sh

secrets-check: ## Verify every op:// reference resolves (read-only)
	bash infra/scripts/secrets-check.sh $(ENV_FILE)
