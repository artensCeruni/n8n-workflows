# Publishing runbook

Taking a workflow from a live n8n instance to a public GitHub repository, without
leaking anything and without breaking it for anyone who clones it.

Follow it top to bottom. Every step names the command, what a pass looks like, and
what to do when it fails.

> **The one-line version, once you know the drill:**
>
> ```bash
> npm run export && npm run check && git add -A && git commit && git push
> ```
>
> Everything below is what that line assumes you have already set up.

---

## 0. Prerequisites — once per machine

| Step            | Command                            | Pass looks like                            |
| --------------- | ---------------------------------- | ------------------------------------------ |
| Dependencies    | `npm install`                      | no errors                                  |
| Pre-commit hook | `npm run hooks`                    | `core.hooksPath=.githooks`                 |
| Env file        | `cp infra/.env.example infra/.env` | file exists, git-ignored                   |
| API key         | n8n → Settings → n8n API → Create  | pasted into `N8N_API_KEY=` in `infra/.env` |

Verify the key works before anything else:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-N8N-API-KEY: $(grep '^N8N_API_KEY=' infra/.env | cut -d= -f2-)" \
  http://localhost:5678/api/v1/workflows?limit=1
```

`200` means good. `401` means the key is wrong. `000` means n8n is not running.

> `make` is not installed on every machine — Windows especially. Every `make X`
> below has an `npm run X` equivalent; use whichever you have.

---

## 1. Is it ready to publish?

Do not publish a workflow that is still half-built. Check honestly:

- [ ] It runs end to end at least once, on real data
- [ ] No node is left with an empty required field (an unset Sheets document, an
      unset Drive folder, a credential not selected)
- [ ] Error paths go somewhere — a failing branch should alert, not vanish
- [ ] You can explain _why_ the non-obvious parts are built that way

The last one matters more than it sounds: if you cannot explain it now, you will
not be able to in six months, and neither will anyone reading the repo.

If it is genuinely not finished but you want it versioned anyway, that is fine —
publish it with `"status": "draft"` in the manifest and say so in the README.

---

## 2. Get it into the repo

### First time for this workflow

```bash
npm run new-workflow -- --slug=invoice-extractor
```

Open the workflow in n8n and copy its id from the URL:

```
http://localhost:5678/workflow/HphoUqxDNnI4BwHg
                               ^^^^^^^^^^^^^^^^
```

Put it in `workflows/invoice-extractor/manifest.json` as `"n8nId"`, then:

```bash
npm run export -- --workflow=invoice-extractor
```

### Every time after that

```bash
npm run export
```

Expected: `= <slug>: unchanged` when nothing changed, `~ <slug>: written` when it
did.

**If it says `manifest has no "n8nId"`** — step above was skipped.
**If it says `Cannot reach n8n`** — n8n is not running, or `N8N_BASE_URL` is wrong.

---

## 3. Clean the data

This is the step that matters. Two categories, and they fail differently.

### 3a. Stripped automatically — you do nothing

`npm run export` removes these on every export, so they cannot reach the repo
even if you forget they exist:

| Removed                                            | Why it would hurt                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `credentials[].id`                                 | Points at a row in _your_ database; useless and instance-revealing       |
| `shared`                                           | Contains the owning project name — **which contains your email address** |
| `staticData`                                       | Gmail poll cursor; another instance would skip mail it never saw         |
| `pinData`                                          | Editor test fixtures                                                     |
| `versionId`, `webhookId`, `instanceId`, timestamps | Instance-local noise                                                     |

### 3b. Your job — move to a Config node

Anything account-specific that lives in a node parameter. Typical culprits:

| Value                                     | Example                                 |
| ----------------------------------------- | --------------------------------------- |
| Email addresses                           | alert recipients, test inboxes          |
| Gmail label ids                           | `Label_42` — different on every account |
| Slack channels                            | `#invoices`, `#invoices-alerts`         |
| Google Drive folder / Sheets document ids | resource-locator values                 |
| Any account, project or workspace id      | —                                       |

**How:**

1. In n8n, add a `Set` node named `Config` near the start of the chain.
   Set `includeOtherFields: true` — otherwise it drops the incoming payload.
2. Add one field per value.
3. Point the consuming nodes at it: `{{ $('Config').first().json.slackChannel }}`.
4. In `manifest.json`, declare a placeholder for **every** field:

   ```json
   "configNodes": {
     "Config": {
       "alertEmail": "you@example.com",
       "slackChannel": "#your-channel"
     }
   }
   ```

5. `npm run export` again. The export rewrites your real values to those
   placeholders. The live instance keeps the real ones.

Placeholders must use `example.com` — the PII scanner recognises reserved
domains and would flag anything else as a real address.

Each independently triggered chain needs its own Config node (`Test Config`,
etc.) — a node that never executed cannot be read.

> **Why not environment variables?** n8n 2.0 blocks `$env` in nodes by default,
> and n8n Cloud cannot set them at all. See
> [ADR-0004](adr/0004-config-node-over-env-vars.md).

### 3c. Never in the repo, in any form

`infra/.env` · `infra/data/` · `*.sqlite` · `config` · anything from
`n8n export:credentials --decrypted` — a command with no legitimate use here.

All are git-ignored and blocked by the pre-commit hook. Do not rely on only one
of those.

---

## 4. Document it

`workflows/<slug>/README.md`, from the template:

- [ ] One-line summary, status, trigger
- [ ] What it does, numbered, in execution order
- [ ] Mermaid diagram
- [ ] Configuration table — every Config field, its placeholder, what to set it to
- [ ] Credentials table — exact names to create in n8n
- [ ] Node table
- [ ] Troubleshooting — symptom, cause, fix

Write an **ADR** in `workflows/<slug>/docs/adr/` for anything a reader would ask
"why is it done this way?" about. Record the option you _rejected_ and why — that
is the part that stops the decision being re-litigated later.

Then regenerate the index:

```bash
npm run readme
```

---

## 5. Write the invariants

The shared suite already covers schema, secret hygiene, credential parity and
export determinism for every workflow automatically. You do not repeat those.

What you add in `workflows/<slug>/tests/invariants.test.mjs` is one assertion per
decision — **if you wrote an ADR, write the test that enforces it.**

The rule of thumb: _what could a future edit silently break?_

```js
// Example: every routing branch must reach the node that marks work done,
// or the trigger reprocesses the same item forever.
const { ok, missing } = everySlotReaches(workflow.connections, 'Router', 'Mark as Processed');
assert.ok(ok, `outputs ${missing.join(', ')} never reach the terminator`);
```

Prefer graph assertions (`everySlotReaches`, `reachableFrom`) over string
matching — they survive refactors that move nodes around.

---

## 6. Verify — the gate

```bash
npm run check
```

Runs four things. All must pass:

| Check          | Fails when                                                              | Fix                                             |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| `validate`     | schema, manifest, credential parity, placeholder parity, PII, label ids | read the message — it names the node and field  |
| `readme:check` | index table is stale                                                    | `npm run readme`                                |
| `format:check` | formatting drifted                                                      | `npm run format`                                |
| `test`         | shared or per-workflow invariants                                       | read what the test asserts _before_ changing it |

**A failing invariant usually means the change has a consequence the ADR warned
about — not that the test is wrong.** If the decision genuinely should change,
update the ADR in the same commit and say why.

Then confirm the export is stable:

```bash
npm run export && git diff --stat
```

An empty diff proves sanitisation is deterministic. A diff you did not expect is
usually a Config value being normalised back to its placeholder — which is the
system working.

---

## 7. Commit and push

```bash
git add -A
git commit          # the pre-commit hook runs here
git push
```

The hook blocks: `infra/.env`, anything under `data/`, real email addresses,
`Label_<n>`, credential ids, `AIza…` / `GOCSPX-` keys, JWTs — plus `gitleaks`
when Docker is running.

Commit messages: Conventional Commits, scoped by slug.

```
feat(invoice-extractor): add Slack review notification
fix(tooling): strip shared field that leaked the owner email
docs(adr): record why config lives in a node
```

**If the hook blocks you**, fix the cause. `git commit --no-verify` exists for
genuine emergencies; if you use it, run `npm run check` before pushing.

---

## 8. After the push

```bash
gh run list --limit 3
```

Seven CI jobs must go green: discover, validate & test, docs, secret scan,
compose config, import smoke, and the summary job.

| Job            | What it proves                                                                  |
| -------------- | ------------------------------------------------------------------------------- |
| Secret scan    | gitleaks over the **full history** — a secret removed from HEAD is still leaked |
| Import smoke   | a clean n8n container actually accepts the JSON                                 |
| Compose config | both Docker profiles still render                                               |

Tagging a release is optional:

```bash
git tag -a v1.1.0 -m "..." && git push origin v1.1.0
```

---

## 9. If a secret was committed

Rotating comes first. Removing it from history does **not** un-leak it — assume
anything pushed to a public repo has been scraped within minutes.

1. **Revoke it now.** Gemini/Anthropic key in the provider console; OAuth client
   in Google Cloud → Credentials.
2. Rotate `N8N_ENCRYPTION_KEY` if `data/config` or `infra/.env` was exposed —
   procedure in [OPERATIONS.md](OPERATIONS.md#rotating-the-encryption-key).
3. Recreate the credentials in n8n **under the same names**. Because binding is by
   name, the workflows keep working with no edits.
4. Purge history with `git filter-repo`, force-push, ask GitHub Support to expire
   cached views.
5. Add a rule to `.gitleaks.toml` for the shape that got through.

---

## Quick reference

```bash
npm run hooks                              # once per clone
npm run new-workflow -- --slug=my-flow     # scaffold
npm run export                             # n8n → repo, sanitised
npm run export -- --workflow=my-flow       # just one
npm run import:dry                         # preview repo → n8n
npm run readme                             # regenerate the index
npm run check                              # validate + docs + format + tests
npm run up / down / logs                   # n8n container
npm run backup                             # archive data + key warning
```

## The three rules

1. **`workflow.json` is generated.** Edit on the canvas, then `npm run export`.
   Hand-edits get silently reverted by the next export.
2. **Account-specific values go in a Config node**, never as literals, never in
   `$env`.
3. **Credentials bind by name.** No secret belongs in this repo, in any form —
   only the names.
