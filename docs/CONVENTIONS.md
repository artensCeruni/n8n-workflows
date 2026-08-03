# Conventions

Rules that keep the tenth workflow looking like the first. Most are enforced by
tooling — where they are, it says so, because a convention nobody checks is a
convention nobody follows.

## Repository layout

```
workflows/<slug>/          one self-contained project
  workflow.json            generated — never hand-edit
  manifest.json            the contract
  README.md                what it does, config, credentials, troubleshooting
  docs/adr/                decisions specific to this workflow
  tests/invariants.test.mjs
infra/                     one n8n container, shared
tooling/                   round-trip toolchain, shared
docs/                      repo-wide conventions and ADRs
```

Directories under `workflows/` beginning with `_` are scaffolding, not projects,
and are skipped by discovery. `_template` is the only one.

## Naming

| Thing                | Rule                                                  | Example                                   |
| -------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Workflow slug        | lowercase kebab-case, starts with a letter            | `email-ai-classifier`                     |
| Directory name       | identical to `manifest.slug`                          | enforced by `validate`                    |
| Workflow name in n8n | Title Case, human-readable                            | `Email AI Classifier`                     |
| Node name            | describes the **action**, not the node type           | `Extract Email Fields`, not `Set`         |
| Config node          | exactly `Config`; extra chains get `<Purpose> Config` | `Test Config`                             |
| ADR file             | `NNNN-kebab-summary.md`, numbered per scope           | `0002-mark-as-processed-at-branch-end.md` |

Node names are effectively an API: expressions reference them as
`$('Node Name')`, so renaming a node silently breaks every expression pointing at
it. Rename via the n8n UI, which rewrites references, then `make export`.

## `manifest.json`

The contract that lets every tool stay generic.

```json
{
  "slug": "email-ai-classifier",
  "name": "Email AI Classifier",
  "description": "One or two sentences. Appears in the README index.",
  "status": "live",
  "trigger": "Gmail poll (1 min)",
  "tags": ["gmail", "gemini"],
  "n8nId": "veg0Vp02D3vWNpHO",
  "minN8nVersion": "2.23.4",
  "credentials": [{ "type": "gmailOAuth2", "name": "Gmail account", "purpose": "…" }],
  "configNodes": { "Config": { "alertEmail": "you@example.com" } }
}
```

`status` is one of `live`, `draft`, `archived`. `n8nId` is empty until the workflow
exists in n8n; `import` prints the new id for you to paste in.

**`status` describes the project, not the toggle.** It is typed by hand and means
_finished and fit to run_ — as opposed to `draft`, still being built, or
`archived`, kept for reference. It is deliberately **not** n8n's `active` flag:
`sanitize.mjs` strips `active` on export, because whether the author's instance
happens to have a workflow switched on says nothing about whether yours should.
So a workflow can read 🟢 live in the README index while sitting inactive in the
instance it was exported from, and that is not a contradiction. Nothing validates
the two against each other, because there is nothing to validate them against.

**`n8nId` is not a secret.** It identifies a row in whichever n8n instance the
workflow was authored on — usually `localhost` — and grants no access on its own;
the API still requires a key. It is committed because `make export` needs to know
which workflow to pull back.

It is, however, **instance-specific**. On a fresh clone that id will not exist, so
`import` treats it as a hint: if the update 404s it creates the workflow instead
and tells you the new id to record. Nobody has to clear the field before their
first import.

Enforced by `tooling/bin/validate.mjs`: required fields, slug/directory match,
credential parity in both directions, and placeholder parity with the actual
Config nodes.

## Configuration

Per-installation values go in a **Config node**, never in `$env` — n8n 2.0 blocks
env access by default and n8n Cloud cannot set it at all
([ADR-0004](adr/0004-config-node-over-env-vars.md)).

Every Config field needs a placeholder in `manifest.json`. A field without one is
a validation error, because the next `make export` would commit its live value.

Placeholders use reserved example domains (`you@example.com`) so the PII scanner
can distinguish them from real addresses.

Read config as `$('Config').first().json.field` — `.first()` rather than `.item`,
because Config is a singleton and is read from branches where item pairing does
not apply.

Each independently triggered chain needs its own Config node. A node that never
executed cannot be read.

## Credentials

Bound **by name**; `sanitize.mjs` strips the id on export. The name is therefore a
public contract — see [CREDENTIALS.md](CREDENTIALS.md).

Reuse one credential across workflows rather than creating per-workflow copies.
Declare every credential a node uses in the manifest; declaring one nothing uses is
also an error.

## Expressions

- Reference an upstream node explicitly (`$('Extract Email Fields').item.json.x`)
  rather than `$json` whenever the value comes from further back than the immediate
  predecessor, or when the node sits after a branch. After a Switch, `$json` holds
  whatever that branch produced.
- Tolerate both shapes when reading structured-parser output:
  `$json.output?.category ?? $json.category`.
- Bound anything that feeds an LLM: `.slice(0, 4000)`.

## Testing

Two tiers, and the split matters:

- **`tooling/tests/shared.test.mjs`** — applies to every workflow automatically.
  Schema, secret hygiene, credential parity, export determinism. Never add
  workflow-specific assertions here.
- **`workflows/<slug>/tests/invariants.test.mjs`** — one assertion per decision
  the workflow made. Rule of thumb: **if you wrote an ADR, write the test that
  enforces it.** An ADR nobody can violate accidentally does not need one; an ADR
  that a future edit could silently undo does.

Prefer graph assertions over string matching where the property is structural —
`everySlotReaches(connections, 'Router', 'Cleanup')` survives refactors that a
regex over the JSON would not.

## Documentation

Every workflow README carries: summary, mermaid diagram, configuration table,
credentials table, node table, ADR links, testing, troubleshooting. Start from
`_template/README.md`.

Write an ADR when the answer to "why is it done this way?" is not obvious from the
code. Record the option you rejected and why — the rejected alternative is the
part that stops someone re-litigating it later.

The root README's workflow table is generated:

```bash
make readme
```

`make readme:check` runs in CI, so stale docs fail the build.

## Commits

Conventional Commits, scoped by workflow slug where applicable:

```
feat(email-ai-classifier): route newsletters to sales
fix(tooling): strip shared field that leaked the owner email
docs(adr): record why config lives in a node
chore(infra): pin n8n to 2.23.4
```

## Not in the repo

- **Empty or scratch workflows.** The n8n instance this repo was built from also
  had a `Test` workflow with zero nodes; it was left in n8n and excluded here. A
  workflow enters the repo when it does something worth documenting.
- **Credential values**, in any form.
- **`infra/data/`** or **`infra/.env`**.
- **Execution history.** It is instance state, pruned on a schedule.
