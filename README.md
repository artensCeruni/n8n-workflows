<div align="center">

# n8n-workflows

**Production n8n automations as versioned, tested, self-contained projects.**

[![CI](https://github.com/artensCeruni/n8n-workflows/actions/workflows/ci.yml/badge.svg)](https://github.com/artensCeruni/n8n-workflows/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![n8n](https://img.shields.io/badge/n8n-2.23.4-EA4B71)](https://n8n.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.6-5FA04E)](https://nodejs.org)

</div>

---

An n8n workflow is usually a JSON blob living inside one person's instance:
undocumented, unversioned, and unrecoverable. This repository treats each one as a
software project instead — with a README, recorded design decisions, tests that
encode those decisions, and a reproducible runtime.

## Workflows

<!-- workflow-index:start -->

| Workflow                                                    | Status  | Trigger            | Nodes | Services                                   |
| ----------------------------------------------------------- | ------- | ------------------ | ----- | ------------------------------------------ |
| [Email AI Classifier](workflows/email-ai-classifier/)       | 🟢 live | Gmail poll (1 min) | 20    | gmail, gemini, ai-agent, triage            |
| [Invoice / Receipt Extractor](workflows/invoice-extractor/) | 🟢 live | Gmail poll (1 min) | 32    | gmail, gemini, invoice, ocr, sheets, slack |

<!-- workflow-index:end -->

<sub>Generated from the manifests by `make readme`. CI fails if it drifts.</sub>

## Quickstart

```bash
git clone https://github.com/artensCeruni/n8n-workflows.git && cd n8n-workflows
npm install
cp infra/.env.example infra/.env      # set N8N_ENCRYPTION_KEY
make up                              # n8n → http://localhost:5678
make import                          # load the workflows
```

Then create the two credentials and fill in the Config nodes —
[full walkthrough](docs/SETUP.md).

No `make`? Every target has an npm equivalent — `npm run up`, `npm run import`,
`npm run check`. GNU make is not standard on Windows; Node already is.

## How it is organised

```
workflows/<slug>/        one self-contained project
  workflow.json          sanitised export — generated, never hand-edited
  manifest.json          the contract: n8n id, credentials, config placeholders
  README.md              what it does, config, credentials, troubleshooting
  docs/adr/              why it is built this way
  tests/                 invariants specific to this workflow
infra/                   one pinned n8n container, shared by all
tooling/                 export / import / validate / scaffold
docs/                    conventions and repo-wide decisions
```

Read one directory under `workflows/` and you understand that workflow completely.
What the projects share is only the runtime, the toolchain and the pipeline —
[ADR-0001](docs/adr/0001-monorepo-layout.md).

## What makes this more than a JSON dump

**Configuration never leaks.** Per-account values — alert addresses, Gmail label
ids — live in a `Config` node on the canvas. On export, `sanitize.mjs` rewrites
them to the placeholders declared in the manifest, so the live instance holds real
values and the repo holds only placeholders. Not `$env`: n8n 2.0 blocks env access
by default, and using it would mean telling every user to weaken that
([ADR-0004](docs/adr/0004-config-node-over-env-vars.md)).

**Credentials bind by name.** Exports keep `{ "name": "Gmail account" }` and drop
the instance-local id, which makes the _name_ a public contract. Create a
credential with that name and `make import` wires up all nine nodes. No secret
exists in this repository in any form.

**Tests encode the design decisions.** Every ADR has an assertion that fails if a
future edit undoes it. The one that earns its keep walks the connection graph and
proves _every_ branch of the router reaches `Mark as Processed` — because the Gmail
trigger filters on unread mail, so a branch missing that terminator would
reprocess the same email every single minute, forever
([ADR-0002](workflows/email-ai-classifier/docs/adr/0002-mark-as-processed-at-branch-end.md)).

**Export is deterministic.** Keys sorted, instance state stripped, config
normalised. A test asserts the committed file is byte-identical to what sanitise
produces, so `make export` on an unchanged workflow yields an empty diff.

**Adding a workflow touches no infrastructure.**

```bash
make new-workflow SLUG=slack-digest
```

The new directory is picked up automatically by the validator, the test suite, the
CI matrix and the README index. Conventions are enforced by tooling rather than by
memory — the path of least resistance is the correct one.

## Commands

| Command                    | What it does                                                 |
| -------------------------- | ------------------------------------------------------------ |
| `make up` / `make down`    | Start / stop n8n (SQLite)                                    |
| `make up-prod`             | Start with Postgres, healthchecks, resource limits           |
| `make export`              | Pull from n8n into the repo, sanitised                       |
| `make import`              | Push from the repo into n8n                                  |
| `make validate`            | Schemas, manifests, config placeholders, PII scan            |
| `make test`                | Shared invariants + per-workflow invariants                  |
| `make check`               | Everything CI runs, locally                                  |
| `make new-workflow SLUG=x` | Scaffold a project                                           |
| `make backup`              | Archive the data directory and warn about the encryption key |
| `make help`                | List every target                                            |

## Documentation

| Document                                | Contents                                                               |
| --------------------------------------- | ---------------------------------------------------------------------- |
| **[PUBLISHING.md](docs/PUBLISHING.md)** | **The runbook: taking a workflow from n8n to this repo, step by step** |
| [SETUP.md](docs/SETUP.md)               | From clone to a running, activated workflow                            |
| [CREDENTIALS.md](docs/CREDENTIALS.md)   | Gmail OAuth2 and Gemini setup, scopes, the encryption key              |
| [OPERATIONS.md](docs/OPERATIONS.md)     | Round-trip, backup, restore, upgrade, key rotation                     |
| [CONVENTIONS.md](docs/CONVENTIONS.md)   | Naming, manifest schema, testing, commits                              |
| [CONTRIBUTING.md](CONTRIBUTING.md)      | Workflow for changes                                                   |
| [SECURITY.md](SECURITY.md)              | Reporting, and what must never be committed                            |

### Decision records

| ADR                                                                                                        | Decision                                          |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [0001](docs/adr/0001-monorepo-layout.md)                                                                   | One monorepo of self-contained projects           |
| [0004](docs/adr/0004-config-node-over-env-vars.md)                                                         | Config node instead of `$env`                     |
| [0005](docs/adr/0005-credential-export-aliases.md)                                                         | Rename credentials on export, not on the instance |
| [email-ai-classifier/0001](workflows/email-ai-classifier/docs/adr/0001-custom-ai-spam-label.md)            | Custom spam label, never Gmail's system SPAM      |
| [email-ai-classifier/0002](workflows/email-ai-classifier/docs/adr/0002-mark-as-processed-at-branch-end.md) | Mark read last, so failures retry                 |
| [email-ai-classifier/0003](workflows/email-ai-classifier/docs/adr/0003-gemini-2-5-flash.md)                | `gemini-2.5-flash` over the 2.0 series            |
| [invoice-extractor/0002](workflows/invoice-extractor/docs/adr/0002-log-and-flag-over-reject.md)            | Log every invoice, flag the doubtful ones         |
| [invoice-extractor/0003](workflows/invoice-extractor/docs/adr/0003-config-node-must-not-strip-binary.md)   | A Config node must not strip binary data          |

## Requirements

Docker Compose v2, Node.js ≥ 20.6, make. n8n runs in Docker; Node is only for the
tooling.

## Not included, on purpose

No Traefik or TLS termination, no queue-mode workers, no secret manager
integration. Each is reasonable for a larger deployment and none is needed to run
this; adding them would mean a domain, a certificate and more moving parts for no
gain at this scale.

## License

[MIT](LICENSE)
