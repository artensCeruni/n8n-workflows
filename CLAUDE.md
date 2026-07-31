# Working in this repo

n8n workflows kept as versioned, tested projects. `workflows/<slug>/` is one
self-contained project; `infra/`, `tooling/`, `docs/` are shared.

**Publishing a workflow: follow [docs/PUBLISHING.md](docs/PUBLISHING.md).** It is
the runbook — export, sanitise, document, test, verify, push.

## Three rules

1. **`workflow.json` is generated — never hand-edit it.** Edit on the n8n canvas,
   then `npm run export`. A test asserts the file is byte-identical to what
   `sanitize.mjs` produces, so hand-edits fail CI and get reverted anyway.
2. **Account-specific values go in a `Config` node**, never as literals and never
   in `$env` — n8n 2.0 blocks env access in nodes by default and n8n Cloud cannot
   set it at all ([ADR-0004](docs/adr/0004-config-node-over-env-vars.md)). Every
   Config field needs a placeholder in `manifest.json`; export rewrites live
   values to it.
3. **Credentials bind by name.** Exports keep `{"name": "Gmail account"}` and drop
   the id. No secret belongs in this repo in any form.

## Commands

Use `npm run`, not `make` — GNU make is not installed on every machine here.

```
npm run hooks     once per clone: enables the pre-commit hook
npm run export    n8n → repo, sanitised
npm run check     validate + readme freshness + format + tests
npm run readme    regenerate the workflow index in README.md
```

`manifest.json` is the contract every tool reads. Adding a workflow means adding a
directory — CI, the test matrix and the README index discover it from the
filesystem, so no pipeline file needs editing.

## Gotchas already paid for

- **Tests run by glob, not directory:** `node --test "tooling/tests/*.test.mjs"
"workflows/*/tests/*.test.mjs"`. Passing a directory makes Node treat it as a
  module.
- **`gen-readme.mjs` pipes its output through Prettier's API.** Without that,
  Prettier's table padding and the generator rewrite each other forever.
- **`workflow.json` is in `.prettierignore`** — `sanitize.mjs` is its formatter of
  record. Letting Prettier touch it breaks the determinism test.
- **`n8n import:workflow` (CLI) requires an `id`; `POST /workflows` (API) does
  not.** The repo strips ids, so the CI smoke test injects a throwaway one.
- **Docker from Git Bash needs `MSYS_NO_PATHCONV=1` and `//` paths**, or `-w /repo`
  becomes `C:/Program Files/Git/repo` and the container fails to start.
- **Never conflate a scanner failing to run with a scanner finding something.**
  The pre-commit hook reads gitleaks' verdict, not its exit code.
- **Never run `n8n export:credentials --decrypted`** — it writes plaintext secrets.

## Never commit

`infra/.env` · `infra/data/` · `*.sqlite` · `config` · `*.credentials.json`

Git-ignored _and_ blocked by the pre-commit hook. If something slips through, see
[SECURITY.md](SECURITY.md) — rotate first, purge second.
