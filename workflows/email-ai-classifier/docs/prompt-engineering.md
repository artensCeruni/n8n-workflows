# Prompt engineering notes

The classifier's accuracy comes almost entirely from two things: a hard output
contract, and a small set of edge-case rules that resolve the cases where two
categories genuinely compete. The model choice matters much less — see
[ADR-0003](adr/0003-gemini-2-5-flash.md).

## The output contract

The agent is paired with a structured output parser whose schema pins the shape:

```json
{
  "category": { "enum": ["urgent", "sales", "personal", "spam"] },
  "reason": { "type": "string" },
  "draft_reply": { "type": "string" },
  "required": ["category", "reason", "draft_reply"],
  "additionalProperties": false
}
```

Three things follow from this, and each prevents a concrete failure:

- **`enum` on `category`** means the value is always one the router can match. A
  free-text category would fall through to the spam fallback, so a hallucinated
  `"important"` would silently get labelled spam.
- **`additionalProperties: false`** stops the model from inventing extra fields
  that later look like real data.
- **`autoFix: true`** retries a malformed response instead of letting `undefined`
  flow into a Gmail draft, which would create an empty reply.

`Merge Classification` reads `$json.output?.category ?? $json.category` because
the parser wraps its result in `output` in some n8n versions and not others. The
fallback covers both rather than breaking on an upgrade.

## The four categories

| Category   | Defining signal                                                                | Action       |
| ---------- | ------------------------------------------------------------------------------ | ------------ |
| `urgent`   | Action needed today; outage, emergency, ≤24h deadline, critical failure        | Email alert  |
| `sales`    | Commercial intent with **no** time pressure — pitch, cold outreach, newsletter | Draft reply  |
| `personal` | Informal register, known sender, social or personal content                    | Draft reply  |
| `spam`     | Unsolicited bulk, scam, phishing, prize claim, crypto scheme                   | Custom label |

## Edge cases, and why each rule exists

These are stated in the system prompt _before_ the decision, because a model that
has already committed to a category rationalises rather than reconsiders.

**Sales rep who mentions urgency → `urgent`.**
"Your trial expires today" is commercial, but the consequence of missing it is
real and time-bound. Time-sensitivity outranks sender intent. The cost asymmetry
drives this: a sales email misrouted as urgent wastes a glance; a genuine deadline
misrouted as sales is missed entirely.

**Looks personal but contains a prize claim or suspicious link → `spam`.**
Friendly register is the cheapest thing for an attacker to fake, so it carries
almost no signal. Fraud markers are expensive to fake and therefore win.

**Newsletter with a limited-time offer → `sales`, not `urgent`.**
Marketing manufactures deadlines. Without this rule, every "48 hours only" promo
becomes an alert and the alert channel loses its meaning — the failure mode is a
channel the user learns to ignore, which is worse than one missed email.

**Genuinely ambiguous → pick the higher-risk category**, ordered
`urgent > personal > sales > spam`.
A tie-break rule beats leaving it to sampling temperature, and it makes the
direction of error deliberate: over-escalating is recoverable, under-escalating is
not.

## `draft_reply`

The prompt makes the model derive `draft_reply` from the category _it just chose_:
2–3 sentences for `sales` and `personal`, an empty string for `urgent` and `spam`.

Deciding it in the same call, from its own answer, keeps the two fields
consistent. The alternative — a second call, or a downstream IF — either doubles
the cost or reintroduces the chance of a draft that contradicts the category.

Drafts are created as **Gmail drafts, never sent**. The model writes; the human
sends. That boundary is deliberate and is the reason a wrong draft costs nothing.

## Changing the prompt

The edge-case rules were tuned against `gemini-2.5-flash`. If you change the
model, re-test all four fixtures in
[`../tests/fixtures/emails.json`](../tests/fixtures/emails.json) — each one exists
because it probes a specific boundary, and the `why` field records which.

The fastest loop is the **Inject Test Emails** branch on the canvas: it sends all
four cases to the watched inbox and the live trigger picks them up, so you
exercise the real path rather than a mock.
