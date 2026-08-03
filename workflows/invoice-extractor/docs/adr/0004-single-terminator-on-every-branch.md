# ADR-0004: Every branch ends at `Mark as Processed`

**Status:** accepted · **Date:** 2026-08-03 · **Scope:** invoice-extractor

## Context

The Gmail trigger filters on `readStatus: unread` and polls **every minute**. A
message stays visible to the trigger until something marks it read. That makes the
mark-read step the only thing standing between this workflow and an infinite loop.

The loop is expensive here in a way it is not elsewhere in this repo. Each pass
costs one or two Gemini calls per attachment against a free-tier quota, a Drive
upload, a Sheets append, and a Slack post — every sixty seconds, for as long as
the email sits in the inbox. A duplicate row per minute also destroys the Invoices
Log, which is the actual deliverable.

There are five terminal outcomes, and the tempting mistake is to treat only the
first as "done":

1. invoice logged
2. invoice logged but flagged for review
3. extraction failed twice
4. attachment type not supported
5. a pipeline step errored (Drive, Sheets, or any Gemini node)

Outcomes 3–5 are the dangerous ones. They _feel_ like failures, and the instinct
is to leave the email unread "so it can be retried". On a one-minute poll that
instinct is a retry loop with no exit.

## Decision

**All five branches converge on one `Mark as Processed` node**, which is the last
node on every path and has nothing downstream of it.

```
Unsupported File Alert       ┐
Extraction Failed Alert      │
Review Required Notification ├─→ Mark as Processed  (markAsRead)
Invoice Logged Notification  │
Pipeline Error Alert         ┘
```

Two properties make one shared node correct for all five:

- **It reads the id from a node that always ran.**
  `messageId: {{ $('Split Attachments').item.json.message_id }}` — not `$json`,
  which by then holds a Slack API response and has no message id at all.
  `Split Attachments` is upstream of every branch, so the reference always
  resolves.
- **It runs after the side effect, never before.** Marking read first would mean
  a Drive or Sheets failure is never retried, because the next poll can no longer
  see the message. Marking read last means a genuine transient failure gets
  exactly one more chance — the next poll — and then stops.

Every Slack alert node carries `onError: continueRegularOutput` so that a Slack
outage cannot strand the item before the terminator. `Mark as Processed` carries
it too: if the mark-read call itself fails, the execution ends rather than
cascading.

## Consequences

- **Bounded cost per email.** One pass, then it is out of the trigger's view.
- **Failures are visible, not silent.** Every non-happy branch posts to the alerts
  channel before marking read, so "processed" never means "discarded quietly".
- **A sixth branch is a build failure, not a surprise.** The graph invariant walks
  every output slot of `Route by File Type`, `Retry Route by File Type`,
  `Parsed Successfully?`, `Retry Parsed Successfully?` and `Review Needed?` and
  proves each reaches `Mark as Processed`. Adding a branch without a terminator
  fails `make test` with the offending slot named.
- **Error outputs are part of the graph, not an escape hatch.** The six nodes with
  `onError: continueErrorOutput` — four Gemini, Drive, Sheets — all wire their
  error slot to `Pipeline Error Alert`, which is itself terminated. An unwired
  error output would swallow the item and leave the email unread. Also asserted.

This is the same failure class as
[email-ai-classifier ADR-0002](../../../email-ai-classifier/docs/adr/0002-mark-as-processed-at-branch-end.md);
the difference is the blast radius. There, a missed terminator re-drafts a reply.
Here it re-bills an AI provider and corrupts a ledger.
