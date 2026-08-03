# ADR-0005: Rename credentials on export, not on the instance

**Status:** accepted · **Date:** 2026-08-03 · **Scope:** repo-wide

## Context

Credential **names** are this repo's public contract. `sanitize.mjs` strips the
credential `id` — it points at a row in one instance's database — and keeps only
the name, so `make import` binds a workflow to whatever the local user created
under that name. That is why every README here says "create a credential called
exactly `Gmail account`".

A public contract derived from a local accident is a problem. While building
`invoice-extractor` the author's Slack credential ended up named **`Slack account
2`**. The `2` carries no meaning — it is an artefact of how that one instance was
set up. Exported as-is it would become an instruction in the README: _create a
Slack credential named `Slack account 2`_, which every cloner would have to
reproduce exactly, and which would look like a mistake in the docs.

The obvious fix is to rename the credential in n8n. That was rejected: the
workflow is **live**, the credential is bound by id inside a running instance,
and renaming it is a change to production made purely for the benefit of a
repository. Editing `workflow.json` by hand is not an option either — it is
generated, so the next `make export` silently reverts it (rule 1 of
[docs/PUBLISHING.md](../PUBLISHING.md)).

## Decision

A manifest credential entry may declare an optional **`liveName`**: the name the
credential has on the authoring instance. Export rewrites it to the public
`name`.

```json
{
  "type": "slackOAuth2Api",
  "name": "Slack account",
  "liveName": "Slack account 2"
}
```

`sanitizeCredentials()` builds a `liveName → name` map from the manifest and
applies it as it reduces each `{ id, name }` reference to `{ name }`. The
mechanism is declarative and generic: nothing in the tooling knows about Slack.

Idempotent by construction — the published name is never itself a key in the map,
so sanitising an already-sanitised workflow is a no-op. The round-trip test
(`the committed file is exactly what sanitize produces`) depends on that.

## Consequences

**The authoring instance is never touched by a publishing decision.** This is the
point. Publishing is a read operation on the running system.

**`make import` binds by the public name.** Importing `invoice-extractor` back
onto the authoring instance leaves its five Slack nodes unbound, because that
instance has no credential called `Slack account`. This is the same class of
hazard as the already-documented one where import overwrites Config nodes with
placeholders: the repo copy is the _published_ form, not a backup of the live
instance. Both are called out in `docs/PUBLISHING.md`.

**One more thing that can drift.** If the credential is later renamed in n8n, the
export stops matching and the live name lands in `workflow.json`. Caught rather
than tolerated: `validate.mjs` and the shared test suite both fail if any declared
`liveName` string appears in a committed workflow, and `validate.mjs` runs in the
pre-commit hook.

**Deliberately not a general renaming layer.** `liveName` maps one name to one
name for one credential. It is not a template, and it does not touch node
parameters — account-specific _values_ belong in a Config node
([ADR-0004](0004-config-node-over-env-vars.md)).

## Alternatives rejected

| Option                                 | Why not                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Rename the credential in n8n           | Changes a live, active instance to suit a repo                              |
| Hand-edit `workflow.json` after export | Reverted by the next export; violates rule 1                                |
| Publish `Slack account 2` verbatim     | Ships a local accident as a contract every cloner must copy                 |
| Post-export `sed` in the export script | Non-declarative, invisible from the manifest, and breaks idempotency checks |

## Enforcement

- `tooling/lib/manifest.mjs` — `liveName` must be a non-empty string and must
  differ from `name`.
- `tooling/bin/validate.mjs` — no declared `liveName` may appear anywhere in the
  serialised workflow. Runs in the pre-commit hook and in CI.
- `tooling/tests/shared.test.mjs` — the same assertion, applied to every workflow
  project automatically.
