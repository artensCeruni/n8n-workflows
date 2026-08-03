# ADR-0001: Retry a failed extraction once, with a simpler prompt

**Status:** accepted · **Date:** 2026-08-03 · **Scope:** invoice-extractor

## Context

Gemini is asked to return a JSON object describing an invoice. Sometimes it does
not: it wraps the object in a ` ```json ` fence, prefixes it with "Here is
the extracted data:", truncates mid-object when the output token budget runs out,
or — on a bad scan — returns prose explaining that it cannot read the document.

`Parse and Validate` already absorbs the cheap cases. It strips fences, slices
from the first `{` to the last `}`, and walks whatever shape the API returned
(`candidates[].content.parts[].text`, `content`, `text`, `response`). What is left
after that is a genuine failure: the model did not produce an object.

The question is what to do with those. Three options were live:

1. Fail the item — alert, write nothing.
2. Retry the same call N times.
3. Retry once, differently.

## Decision

**Retry exactly once, with a stripped-down prompt**, then give up.

`Parsed Successfully?` routes `parse_ok === false` into `Retry Route by File Type`,
which re-dispatches to `Retry Extraction PDF` / `Retry Extraction Image`. Those
nodes carry a deliberately smaller prompt: fewer fields, no line-item schema, no
formatting commentary — just the handful of values that matter, asked for plainly.
`Parse Retry Result` runs the same parser again. If it fails a second time,
`Extraction Failed Alert` fires and **no row is written**.

## Why not more retries

The second failure is rarely transient. The failures this hits are structural —
an unreadable scan, a document that is not an invoice, a prompt the model keeps
answering in prose — and re-asking the same question does not fix any of them.
Each attempt is a real API call against a free-tier quota, and a retry loop on a
trigger that polls **every minute** compounds: an email that can never parse would
burn N calls a minute, forever, because it is never marked read.

Retrying with a _different, simpler_ prompt is the only variant with a plausible
mechanism behind it. Shorter output is less likely to hit the token ceiling, and
fewer requested fields means less room for the model to editorialise.

## Why not fail immediately

Measured on the fixture set, the simplified retry recovers the truncation and
"here is your data:" cases — the majority of first-pass failures. One extra call
on the minority of items that failed is cheap; losing an invoice is not.

## Consequences

- Worst case per attachment is **two** Gemini calls, bounded and predictable.
- The retry path rejoins the main path at `Invoice Ready`, so every downstream
  expression reads `$('Invoice Ready').item.json` and first-pass and retry
  results are indistinguishable from there on. This is what keeps the Sheets and
  Slack nodes from needing to know which path an item took.
- The retry prompt must stay **different** from the first-pass prompt, or the
  retry is just a duplicate call. Asserted in `tests/invariants.test.mjs`.
- A permanently unparseable attachment still ends at `Mark as Processed`, so it
  leaves the unread queue after one round trip. See
  [ADR-0004](0004-single-terminator-on-every-branch.md).
