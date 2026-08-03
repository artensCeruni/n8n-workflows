# ADR-0003: The Config node must pin `stripBinary: false`

**Status:** accepted · **Date:** 2026-08-03 · **Scope:** invoice-extractor

## Context

[ADR-0004 (repo-wide)](../../../../docs/adr/0004-config-node-over-env-vars.md)
puts per-installation configuration in a `Set` node named `Config` at the head of
the chain, with `includeOtherFields: true` so the incoming payload survives.

This workflow is the first one here that carries **binary data**. The Gmail
trigger downloads attachments into `binary.attachment_0`, `attachment_1`, …;
`Split Attachments` fans them out one per item; the Gemini nodes read the binary
directly. Config sits upstream of all of it, between `New Invoice Email` and
`Split Attachments` — the only placement that puts it in front of _every_
consumer, including the unsupported-file and error branches.

A `Set` node in that position is not a passive pass-through. From
`Set/v2/helpers/utils.js` in n8n 2.23.4:

```js
const includeBinary =
  (nodeVersion >= 3.4 && !options.stripBinary && options.include !== 'none') ||
  (nodeVersion < 3.4 && !!options.includeBinary);
if (includeBinary && inputItem.binary !== undefined) {
  /* copy binary across */
}
```

and from the node descriptor:

```js
{ displayName: 'Strip Binary Data', name: 'stripBinary', type: 'boolean',
  default: true,
  displayOptions: { show: { '@version': [{_cnd:{gte:3.4}}], '/includeOtherFields': [true] } } }
```

`options` is a `collection`, so an option that was never added is simply absent
and `!undefined` is `true` — a freshly created Config node does pass binary
through. But the field's **declared default is `true`**, and it is shown in the
editor exactly when `includeOtherFields` is on. The first person who opens that
Options collection and touches anything gets `stripBinary: true` written into the
node, and from then on every attachment is silently dropped at the second node in
the workflow.

The failure is invisible in the way that matters: `json` still flows, so
`Split Attachments` still runs, still reads `item.binary` — now `{}` — finds no
`attachment_*` keys, and returns **zero items**. No error, no alert, no Slack
message. The workflow simply stops producing invoices, and the error branches
never fire because nothing failed.

## Decision

`Config` stores `options: { "stripBinary": false }` **explicitly**, not by
omission.

Pinning it converts an invisible default into a visible, diffable, testable
statement of intent. `tests/invariants.test.mjs` asserts it, along with
`includeOtherFields === true` and `typeVersion >= 3.4`, and the assertion names
this ADR when it fails.

`includeBinary` is deliberately **not** set: it is the pre-3.4 spelling and is
ignored at `typeVersion 3.4`, so writing it would only suggest a protection that
is not there.

## Consequences

- Attachments survive Config. This is the entire pipeline.
- Any future `Set` node inserted into the attachment path needs the same
  treatment. The test covers `Config` by name; a new node is a new assertion.
- `Test Config` is exempt — it sits on the injector branch, which builds its
  binary downstream in `Generate Test Invoices`.
- If n8n changes the option's semantics in a later `typeVersion`, the pinned value
  and the version assertion fail together rather than degrading quietly. That is
  the point of asserting the version alongside the option.

## Alternatives rejected

| Option                                      | Why not                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Rely on the option being absent             | One editor visit away from silent data loss                                             |
| Put Config after `Split Attachments`        | Leaves the unsupported-file branch, which runs before it, unable to read its channel id |
| Skip the Config node, hardcode the channels | Violates repo rule 2; ships the author's Slack ids to a public repo                     |
| Detect the empty result downstream          | Detects the symptom one node too late, and only for the happy path                      |
