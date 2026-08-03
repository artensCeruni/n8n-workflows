# ADR-0002: Log every parsed invoice, flag the doubtful ones

**Status:** accepted · **Date:** 2026-08-03 · **Scope:** invoice-extractor

## Context

An extracted invoice can be wrong in ways the workflow can detect without a human:

- the arithmetic does not close — `subtotal + tax ≠ total`
- the model reports low confidence in its own reading
- a field the row needs is simply absent

The obvious design is a gate: only well-formed invoices get written to the
Invoices Log, everything else is rejected and alerted. That keeps the sheet clean.

It also makes the sheet a liar. A rejected invoice is still an invoice that
arrived, and the only record of it is a Slack message that scrolls away. Someone
reconciling the month against the log would see a total that is quietly missing
the rows the pipeline did not like.

## Decision

**Anything that parses gets a row.** Doubt is expressed as data on that row, not
as absence.

`Parse and Validate` computes three booleans and a note:

| Field             | Meaning                                               |
| ----------------- | ----------------------------------------------------- |
| `parse_ok`        | the model returned a JSON object                      |
| `math_ok`         | `\|subtotal + tax − total\| ≤ max(0.02, 1% of total)` |
| `needs_review`    | `!parse_ok \|\| !math_ok \|\| confidence < 0.6`       |
| `validation_note` | human-readable list of what was wrong                 |

`Review Needed?` then routes on `needs_review`: true → `Review Required
Notification` in the alerts channel, false → `Invoice Logged Notification` in the
invoices channel. **Both** run after the row has been appended.

The only thing that is never written is an invoice that failed to parse twice —
there is nothing to write. That path ends at `Extraction Failed Alert`
([ADR-0001](0001-two-pass-extraction.md)).

## The tolerance, and why tax is not required

`max(0.02, 1%)` — two cents absolute, one percent relative. The absolute floor
covers per-line rounding on small receipts, where a fixed percentage is too tight;
the relative term covers large invoices, where two cents is absurdly strict.

**A missing tax line is treated as `0`, not as missing data.** The first version
treated a null `tax_amount` as unknown and refused to check the arithmetic, which
flagged every tax-exempt receipt — a large share of real traffic and all of it
correct. A receipt with no VAT row is a normal receipt. The math still runs, and
`validation_note` records `no tax line; treated as 0` so the assumption is visible
on the row rather than buried in code.

`confidence < 0.6` is the model's own estimate, so it catches the case the
arithmetic cannot: a clean-looking total read off a blurry scan.

## Consequences

**The Invoices Log is complete.** Every invoice the pipeline saw and could parse
is in it. `needs_review` is a filter, so "show me what needs checking" is a
spreadsheet filter rather than a search through Slack history.

**Reviewers get the link, not the alert alone.** `Review Required Notification`
carries the vendor, invoice number, total, confidence, the specific
`validation_note`, and the Drive `webViewLink` of the original file — enough to
resolve it without opening n8n.

**Accepted cost:** a wrong row can be written. That is deliberate — a wrong row
that is flagged, greppable and linked to the source document is a better failure
than a missing row nobody knows about. Downstream consumers of the sheet must
filter on `needs_review`; that is documented in the README rather than enforced.

**Ruled out:** writing doubtful rows to a second "quarantine" sheet. It splits the
data set in two, so every query needs a union, and it recreates the same problem
one level down — someone has to remember the second sheet exists.
