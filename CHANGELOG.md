# Changelog

All notable changes to this repository. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), where a major bump
means a breaking change to the manifest contract or the tooling interface.

## [Unreleased]

## [1.0.0] — 2026-07-30

First release. Establishes the monorepo and migrates the first workflow into it.

### Added

**Repository**

- Monorepo layout: `workflows/<slug>/` holds self-contained projects; `infra/`,
  `tooling/` and `.github/` are shared ([ADR-0001](docs/adr/0001-monorepo-layout.md)).
- `manifest.json` as the per-workflow contract — n8n id, credentials, Config
  placeholders, status — read by every tool so nothing is hardcoded per workflow.
- `workflows/_template/` plus `make new-workflow SLUG=x`, so a new project is
  discovered automatically by the validator, tests, CI matrix and README index.

**Workflow: Email AI Classifier**

- Gmail triage via Google Gemini 2.5 Flash into urgent / sales / personal / spam,
  with an alert, threaded draft replies, or a non-destructive label.
- Four ADRs recording the non-obvious decisions: custom spam label over Gmail's
  system `SPAM`, terminator placement for retry safety, model choice, and
  configuration strategy.
- `Bootstrap: List Gmail Labels` — a disabled helper for discovering the
  per-account label id.
- End-to-end test harness on the canvas (`Inject Test Emails`) covering all four
  categories.

**Tooling**

- Deterministic sanitisation: strips credential ids, `versionId`, `webhookId`,
  `pinData`, `staticData` and `shared`, sorts keys, and rewrites Config values to
  their declared placeholders.
- `make export` / `make import` round-trip against the n8n public API.
- `make validate` — schema, manifest, credential parity, placeholder parity, plus
  PII and label-id scanning.
- Two-tier tests: shared invariants applied to every workflow automatically, and
  per-workflow invariants that encode the ADRs. Includes a graph traversal proving
  every routing branch reaches the terminator.
- `make readme` generates the workflow index; `--check` fails CI on drift.

**Infrastructure**

- Docker Compose with the n8n image pinned to `2.23.4`, a healthcheck, log
  rotation and explicit `GENERIC_TIMEZONE` (n8n otherwise defaults to
  `America/New_York`, shifting every cron trigger and `$now`).
- Production overlay: Postgres 16 with `pg_isready` gating n8n startup, and
  resource limits.
- `infra/backup.sh` — stops n8n for a consistent SQLite archive, rotates to the 10
  most recent, and warns when the encryption key exists only inside `data/config`.

**CI**

- Job matrix discovered from `workflows/*`, so adding a project needs no pipeline
  change.
- gitleaks over the full history, with custom rules for email literals, Gmail label
  ids and Google credential shapes.
- Both Compose profiles rendered, and every workflow imported into a clean n8n
  container to prove the JSON loads.

### Security

- No secret of any kind is committed. Credentials bind by **name**; the
  instance-local id is stripped on export, which makes the credential name a public
  contract and lets `make import` wire up a fresh instance automatically.
- Configuration lives in a Config node rather than `$env`. n8n 2.0 blocks env
  access in nodes by default; relying on it would require every user to disable
  that protection, and would not work on n8n Cloud at all
  ([ADR-0004](docs/adr/0004-config-node-over-env-vars.md)).
- `shared` is stripped on export — it embeds the owning project name, which
  contains the owner's email address.

### Notes

- The source instance also contained an empty scratch workflow named `Test`
  (0 nodes). It was left in n8n and deliberately excluded here.

[Unreleased]: https://github.com/artensCeruni/n8n-workflows/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/artensCeruni/n8n-workflows/releases/tag/v1.0.0
