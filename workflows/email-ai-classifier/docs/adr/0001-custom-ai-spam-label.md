# ADR-0001: Label suspected spam with a custom label, never Gmail's system SPAM

**Status:** accepted · **Date:** 2026-06-08

## Context

The classifier assigns one of four categories to every incoming email. The spam
branch has to do _something_ with mail the model believes is spam.

The obvious implementation is to apply Gmail's built-in `SPAM` label, which is
what a user would do manually. The Gmail node supports it, and it takes the mail
out of the inbox — apparently exactly what is wanted.

## Decision

Apply a **custom user label** (`AI/Spam`, whose id lives in the Config node).
Never apply the system `SPAM` label, and never delete or trash the message.

The message stays in the inbox. The AI layer is advisory, not destructive.

## Consequences

Applying the system `SPAM` label does two things, and only the first is obvious:

1. It removes the message from the inbox. A false positive hides real mail.
2. **It trains Gmail's own spam filter on that account.** Gmail treats manual
   spam marking as a supervised signal. So a false positive does not just hide
   one message — it teaches the account's filter that similar legitimate mail is
   spam, and the error compounds over time on mail this workflow never sees.

The second effect is not reversible by fixing the prompt later. That asymmetry is
the whole argument: a missed spam email costs one moment of annoyance, while a
false positive fed back into Gmail's classifier degrades an account permanently.

With a custom label instead:

- Mistakes are visible and cost nothing — the mail is still in the inbox.
- The label doubles as an audit trail of what the model thought.
- The user can build their own Gmail filter on that label once they trust it,
  which puts the destructive decision back in human hands.

Accepted trade-off: spam still reaches the inbox, so this workflow reduces
triage effort rather than eliminating it.

## Enforcement

`tests/invariants.test.mjs` asserts that the spam node uses `addLabels`, that it
never references `"SPAM"` or `"TRASH"`, and that its label id comes from Config.
Switching to the system label fails the build.
