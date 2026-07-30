# Summary

<!-- What changes, and why. Link an issue if there is one. -->

## Type

- [ ] New workflow
- [ ] Change to an existing workflow
- [ ] Tooling / infra
- [ ] Documentation only

## Checklist

- [ ] `make check` passes locally (validate + README freshness + formatting + tests)
- [ ] `workflow.json` was produced by `make export`, not edited by hand
- [ ] No real email address, API key, or Gmail label id anywhere in the diff
- [ ] Every Config node field has a placeholder declared in `manifest.json`
- [ ] Credentials in the manifest match the ones nodes actually use
- [ ] Workflow README updated (config table, credentials, troubleshooting)

## For a new workflow

- [ ] Scaffolded with `make new-workflow SLUG=…`
- [ ] `manifest.json` filled in, including `n8nId` and `status`
- [ ] `make readme` run to add it to the index
- [ ] At least one invariant test that encodes a real decision

## Design decisions

<!-- Anything a reviewer would ask "why this way?" about belongs in an ADR under
     docs/adr/ or workflows/<slug>/docs/adr/. Link it here. Say what you rejected
     and why — that is the part that stops it being re-litigated later. -->

## Verification

<!-- How you know it works. For a workflow change, say whether you ran it against
     real data — e.g. the Inject Test Emails branch — not just the test suite. -->
