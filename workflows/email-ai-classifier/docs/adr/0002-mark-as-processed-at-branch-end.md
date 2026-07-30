# ADR-0002: Mark the email read at the end of every branch, never earlier

**Status:** accepted · **Date:** 2026-06-08

## Context

The Gmail Trigger polls every minute with `readStatus: unread` and
`filters.q: in:inbox`. n8n has no memory of which messages it has already handled
— "unread" _is_ the queue.

That makes read-status a side effect the workflow must manage itself, and it
creates two failure modes that pull in opposite directions:

- **Never mark it read** → the next poll, one minute later, picks up the same
  email. It is classified again, alerted again, drafted again. Forever, at one
  Gemini call and up to two Gmail writes per minute per message.
- **Mark it read too early** → if the branch then fails, the message is invisible
  to the next poll. The failure is silent and permanent.

## Decision

A single `Mark as Processed` node (`markAsRead`) is the **terminal node of all
four branches**. Every routing output must reach it, and nothing runs after it.

It reads the message id via `$('Merge Classification').item.json.emailId` rather
than `$json.emailId`.

## Consequences

**Ordering.** Placing it last makes the workflow retry-safe by construction: if
the alert send or the draft creation fails, the message is still unread, so the
next poll retries the whole branch. Recovery needs no dead-letter queue and no
state of its own — the inbox is the state.

The cost is that a _partial_ failure can duplicate a side effect. If the draft
succeeds and `Mark as Processed` fails, the next cycle creates a second draft.
This is accepted: a duplicate draft is visible and harmless, whereas a silently
dropped urgent email is not. At-least-once beats at-most-once here.

**Why the explicit node reference.** By the time execution reaches
`Mark as Processed`, `$json` holds whatever the branch last emitted — a Gmail
draft response on two branches, a label response on another, a send response on
the fourth. None of them carry the original message id. Referencing
`Merge Classification` explicitly is what lets one shared node serve all four
branches; with `$json` it would work on zero of them.

**Fan-in, not duplication.** All four branches converge on one node rather than
each having its own copy. Four copies would be four places to forget to update.

## Enforcement

`tests/invariants.test.mjs` walks the connection graph and asserts that _every_
output slot of `Route by Category` reaches `Mark as Processed`, that nothing is
reachable after it, and that its `messageId` references `Merge Classification`.

This is the test that matters most in the repo. Adding a fifth branch and
forgetting the terminator is an easy mistake with an expensive, silent failure
mode — so it is a build error instead.
