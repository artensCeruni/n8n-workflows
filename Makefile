# n8n-workflows — developer entrypoints.
# Every target is safe to run repeatedly. Nothing here pushes to GitHub or
# writes to a remote n8n instance without an explicit target being named.

SHELL := /bin/sh
COMPOSE := docker compose -f infra/docker-compose.yml
COMPOSE_PROD := docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml

.DEFAULT_GOAL := help
.PHONY: help install hooks up up-prod down restart logs ps shell \
        export import import-dry validate test check format readme \
        new-workflow backup secrets clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install dev dependencies
	npm install

hooks: ## Enable the pre-commit hook (run once after cloning)
	git config core.hooksPath .githooks
	@chmod +x .githooks/* 2>/dev/null || true
	@echo "pre-commit hook enabled. Bypass a single commit with: git commit --no-verify"

# ── n8n runtime ──────────────────────────────────────────────────────────────

up: ## Start n8n (SQLite profile)
	$(COMPOSE) up -d
	@echo "n8n → http://localhost:$${N8N_PORT:-5678}"

up-prod: ## Start n8n + Postgres (production profile)
	$(COMPOSE_PROD) up -d

down: ## Stop containers (data volume is preserved)
	$(COMPOSE) down

restart: ## Recreate the n8n container, picking up .env changes
	$(COMPOSE) up -d --force-recreate n8n

logs: ## Tail n8n logs
	$(COMPOSE) logs -f --tail=100 n8n

ps: ## Show container status
	$(COMPOSE) ps

shell: ## Open a shell inside the n8n container
	$(COMPOSE) exec n8n sh

# ── Workflow round-trip ──────────────────────────────────────────────────────

export: ## Pull workflows from n8n into the repo (sanitised). WORKFLOW=<slug> for one
	node tooling/bin/export.mjs $(if $(WORKFLOW),--workflow=$(WORKFLOW),--all)

import: ## Push workflows from the repo into n8n. WORKFLOW=<slug> for one
	node tooling/bin/import.mjs $(if $(WORKFLOW),--workflow=$(WORKFLOW),--all)

import-dry: ## Show what import would change, without writing
	node tooling/bin/import.mjs --all --dry-run

# ── Quality gates ────────────────────────────────────────────────────────────

validate: ## Validate schemas, manifests and config placeholders
	node tooling/bin/validate.mjs

test: ## Run shared invariants + per-workflow invariants
	node --test "tooling/tests/*.test.mjs" "workflows/*/tests/*.test.mjs"

readme: ## Regenerate the workflow index table in README.md
	node tooling/bin/gen-readme.mjs

format: ## Format all files
	npx prettier --write .

secrets: ## Scan the full git history for secrets (requires gitleaks)
	gitleaks detect --config .gitleaks.toml --redact --verbose

check: ## Everything CI runs, locally
	node tooling/bin/validate.mjs
	node tooling/bin/gen-readme.mjs --check
	npx prettier --check .
	node --test "tooling/tests/*.test.mjs" "workflows/*/tests/*.test.mjs"

# ── Scaffolding & ops ────────────────────────────────────────────────────────

new-workflow: ## Scaffold a new workflow project. Usage: make new-workflow SLUG=my-flow
	@test -n "$(SLUG)" || (echo "error: SLUG is required, e.g. make new-workflow SLUG=slack-digest" && exit 1)
	node tooling/bin/new-workflow.mjs --slug=$(SLUG)

backup: ## Back up the n8n data directory and encryption key
	sh infra/backup.sh

clean: ## Remove installed dependencies
	rm -rf node_modules
