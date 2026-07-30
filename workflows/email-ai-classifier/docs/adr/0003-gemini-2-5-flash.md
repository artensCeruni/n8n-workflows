# ADR-0003: Use `models/gemini-2.5-flash`, not the 2.0 series

**Status:** accepted · **Date:** 2026-06-08

## Context

The classifier runs once per incoming email, on a trigger that polls every
minute. Cost and latency per call matter more than raw capability: the task is
four-way classification of a short text plus a two-sentence draft reply, which is
comfortably within a small model's ability.

The obvious pick for a cheap Google model is the 2.0 Flash series.

## Decision

Use `models/gemini-2.5-flash` via the Google Gemini (PaLM) API credential.

## Consequences

**Why not 2.0.** On the free tier, the 2.0 series returned quota errors
immediately — it has no usable free allowance on the key this workflow was built
with, while 2.5-flash does. A model that 429s on every call is not a cheaper
model, it is a broken one. This is an empirical property of the account tier, not
a statement about the models' capabilities, so re-check it if you are on a paid
key.

**Why Flash rather than Pro.** The output is constrained by a structured output
parser to four enum values plus two short strings. Reasoning depth is not the
bottleneck; the prompt's edge-case rules do the discriminating work. Pro would
add latency and cost for no measurable accuracy gain on this task.

**Structured output.** The model is paired with an output parser that pins
`category` to an enum and sets `additionalProperties: false`. This matters more
than model choice: it converts "the model usually returns the right shape" into a
hard contract, and `autoFix` retries a malformed response instead of letting
`undefined` flow downstream into a Gmail draft.

**Migration note.** Changing the model means re-reading
[`prompt-engineering.md`](../prompt-engineering.md): the edge-case rules were
tuned against 2.5-flash's tendencies, in particular its handling of sales mail
that mentions a deadline.

## Related

Recorded separately because it is an account-level fact rather than a workflow
one: the 2.0 free-tier quota behaviour applies to any workflow on the same key.
