# ADR-0001: One monorepo of self-contained workflow projects

**Status:** accepted · **Date:** 2026-07-30 · **Scope:** repo-wide

## Context

Every workflow here runs on the **same** n8n instance, shares the same
credentials, and is deployed the same way. What differs between them is the
workflow definition, its documentation, and its tests.

Two obvious layouts:

- **One repo per workflow.** Each is independent, but every one needs its own
  Docker setup, its own CI, its own tooling — duplicated N times and drifting
  immediately. Ten workflows would mean ten Docker Compose files describing one
  container.
- **One repo, one big pile.** Shared infra, but no boundary between projects: a
  single README grows unreadable and it becomes unclear which docs describe what.

## Decision

A monorepo where `workflows/<slug>/` is a **self-contained project** —
`workflow.json`, `manifest.json`, `README.md`, `docs/adr/`, `tests/` — and
everything genuinely shared lives at the root: `infra/` (one container),
`tooling/` (one round-trip toolchain), `.github/` (one pipeline), `docs/`
(conventions that apply to all).

You can read one workflow directory and understand that workflow completely,
without opening anything else.

## Consequences

**The manifest is what makes this work.** `manifest.json` declares the n8n id,
required credentials, and Config placeholders. Every tool reads the manifest
instead of hardcoding per-workflow knowledge, so `export`, `import`, `validate`,
`gen-readme`, the test suite and the CI matrix are all generic. Adding the second
or the tenth workflow touches no script and no pipeline file.

**Conventions are enforced by tooling, not discipline.**
`make new-workflow SLUG=x` scaffolds from `workflows/_template/`, and the new
directory is immediately picked up by the shared test suite, the validator, the
CI matrix and the README index. The path of least resistance is the correct one,
which is the only kind of convention that survives a year.

**Costs, accepted:**

- Tests run for every workflow on every change. Fine at this scale; if the repo
  grows to dozens, CI can filter by changed paths.
- One CI status covers all workflows, so an unrelated failure blocks a merge.
- Everything shares one n8n version. This is a feature — `minN8nVersion` in each
  manifest records the floor, and a single pinned image in `infra/` means an
  upgrade is tested against all workflows at once.

**Boundary that keeps this honest:** this layout is right _because_ these projects
share a runtime. Unrelated projects — a web app, a Python service — belong in
their own repositories; they would only inherit a CI pipeline and a Docker setup
that do not apply to them.

## Enforcement

- `tooling/lib/manifest.mjs` discovers projects from the filesystem; nothing
  keeps a hand-maintained list that could drift.
- `tooling/tests/shared.test.mjs` generates its suites from that discovery, so an
  undocumented or malformed project fails the build.
- `gen-readme --check` fails CI when the root index no longer matches the
  manifests.
