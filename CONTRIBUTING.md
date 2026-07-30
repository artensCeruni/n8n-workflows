# Contributing

## Setup

```bash
git clone https://github.com/artensCeruni/n8n-workflows.git && cd n8n-workflows
npm install
cp infra/.env.example infra/.env      # set N8N_ENCRYPTION_KEY
make up
```

Full walkthrough including credentials: [docs/SETUP.md](docs/SETUP.md).

## The one rule about `workflow.json`

**Never edit it by hand.** It is generated. Edit on the n8n canvas, then:

```bash
make export
```

Hand-edits break export determinism, and the next `make export` silently reverts
them. A test asserts the committed file is byte-identical to what sanitise
produces, so CI catches this — but the round trip is faster than the argument.

## Changing an existing workflow

```bash
# 1. edit on the canvas at http://localhost:5678
make export          # 2. pull it in
make check           # 3. validate + docs freshness + format + tests
```

Then update the workflow's `README.md` if you changed behaviour, configuration, or
credentials, and commit.

If a test fails, read what it asserts before changing it. The per-workflow tests
encode decisions recorded in ADRs — a failure usually means the change has a
consequence the ADR warned about, not that the test is wrong. If the decision
genuinely should change, update the ADR in the same pull request and say why.

## Adding a workflow

```bash
make new-workflow SLUG=slack-digest
```

Then:

1. Build it in n8n and copy its id from the URL.
2. Set `n8nId`, `description`, `trigger`, `tags` and `status` in the new
   `manifest.json`.
3. `make export WORKFLOW=slack-digest`
4. Declare each credential the nodes use, and a placeholder for every Config field.
5. Write the README from the template, and at least one invariant test that encodes
   a real decision.
6. `make readme` to add it to the index.
7. `make check`

Nothing in CI, the test suite or the tooling needs editing — projects are discovered
from the filesystem.

## Configuration and secrets

Per-installation values go in a **Config node**, never as a literal and never via
`$env` ([ADR-0004](docs/adr/0004-config-node-over-env-vars.md)). Every Config field
needs a placeholder in the manifest; a field without one is a validation error,
because the next export would commit its live value.

Placeholders must use a reserved example domain (`you@example.com`) so the PII
scanner can tell them apart from real addresses.

Read [SECURITY.md](SECURITY.md) before your first export. In short: never commit
`infra/data/` or `infra/.env`, and never run
`n8n export:credentials --decrypted`.

## Design decisions

Write an ADR when the answer to _"why is it done this way?"_ is not obvious from
the workflow itself. Repo-wide decisions go in `docs/adr/`; workflow-specific ones
in `workflows/<slug>/docs/adr/`.

Record the option you **rejected** and why. The rejected alternative is the part
that stops the decision being re-litigated in six months — and if it was rejected
for an empirical reason, say what you measured. ADR-0004 exists because a probe
workflow proved `$env` was blocked; that evidence is more useful than the
conclusion.

Then write the test that enforces it.

## Style

- Conventional Commits, scoped by slug: `feat(email-ai-classifier): …`,
  `fix(tooling): …`, `docs(adr): …`, `chore(infra): …`
- `make format` before committing
- Node names describe the action, not the node type: `Extract Email Fields`, not
  `Set`. They are referenced by expressions as `$('Node Name')`, so rename through
  the n8n UI — which rewrites references — rather than by editing JSON.
- Full conventions: [docs/CONVENTIONS.md](docs/CONVENTIONS.md)

## Pull requests

`make check` must pass. CI additionally scans the full git history for secrets,
renders both Compose profiles, and imports every workflow into a clean n8n
container to prove the JSON is actually loadable.

Say in the description how you verified the change. For a workflow change, whether
you ran it against real data matters more than whether the tests pass — for
email-ai-classifier that means the **Inject Test Emails** branch.
