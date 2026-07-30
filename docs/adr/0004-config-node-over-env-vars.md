# ADR-0004: Keep per-installation configuration in a Config node, not `$env`

**Status:** accepted · **Date:** 2026-07-30 · **Scope:** repo-wide

## Context

Workflows in this repo are exported from a live n8n instance and committed to a
**public** repository. Some node parameters are inherently per-installation:

- the address urgent alerts are sent to
- the Gmail label id used for suspected spam (label ids are per-account)
- the inbox the test injector sends to

Left as literals, these ship a maintainer's email address to GitHub and silently
mislabel mail on anyone else's account. They have to come from somewhere else.

The textbook answer is environment variables — 12-factor, factor III. n8n exposes
them in expressions as `$env.MY_VAR`.

## Decision

Configuration lives in a **`Set` node named `Config`** at the head of each chain.
Downstream nodes read it as `$('Config').first().json.<field>`.

`manifest.json` declares a placeholder for every Config field. `sanitize.mjs`
rewrites the live values to those placeholders on export, so the live instance
holds real values and the repo holds only placeholders.

`$env` is not used anywhere, and `N8N_BLOCK_ENV_ACCESS_IN_NODE` stays at its
secure default.

## Why not `$env`

This was the original plan. It was tested before being adopted, and the test
killed it. A probe workflow evaluating `{{ $env.NODE_ENV }}` on n8n 2.23.4:

```
NodeOperationError: access to env vars denied
  causeDetailed: If you need access please contact the administrator to remove
                 the environment variable 'N8N_BLOCK_ENV_ACCESS_IN_NODE'
```

The variable was not set. n8n 2.0 ships a breaking change —
`dist/modules/breaking-changes/rules/v2/process-env-access.rule.js`, titled
_"Block process.env Access in Expressions and Code nodes"_ — that blocks env
access **by default**. The documented escape hatch is
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.

So `$env` would work, but only by turning off a security default that n8n
deliberately introduced. That is the wrong instruction to put in a public repo's
setup guide: it asks every user to weaken their instance to run someone else's
workflow. It also fails outright on n8n Cloud, where users cannot set container
environment variables at all.

## Consequences

**Better than the original plan, not merely a fallback.**

- Works unmodified on self-hosted _and_ n8n Cloud, with security defaults intact.
- Configuration is **visible on the canvas**. A newcomer opening the workflow sees
  the two values they need to change without reading any documentation — the
  discoverability that env vars lose.
- No infra coupling: no `.env` to plumb through Docker, no container restart to
  change a value, no divergence between what the repo says and what the running
  container has loaded.

**Costs, accepted:**

- Config values pass through the item stream, so `Config` needs
  `includeOtherFields: true` to avoid dropping the upstream payload. There is a
  test for this, because getting it wrong empties every downstream field.
- Each independently triggered chain needs its own Config node (hence
  `Test Config`), since a node that never executed cannot be read.
- Sanitisation now depends on the manifest being accurate. Mitigated by
  validation: a Config field with no declared placeholder is a build error, so the
  failure mode is a red build rather than a silent leak.

**Ruled out:** n8n _Variables_ (`$vars`) would be the most idiomatic option, but
they are a licensed feature and unavailable on Community Edition.

## Enforcement

- `tooling/bin/validate.mjs` — Config fields and manifest placeholders must match
  exactly, in both directions.
- `tooling/tests/shared.test.mjs` — no workflow may contain `$env`, no real email
  address, and no `Label_<digits>` literal.
- `.gitleaks.toml` — the same shapes are blocked at commit time and in CI.
