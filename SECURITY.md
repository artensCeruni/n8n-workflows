# Security

## Reporting a vulnerability

Use GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
(Security → Report a vulnerability) rather than opening a public issue.

Please include what you found, how to reproduce it, and what an attacker could do
with it. Expect a first response within a week.

## What this repository does and does not contain

**It contains no secrets.** No API keys, no OAuth tokens, no passwords, encrypted
or otherwise. Workflows reference credentials by _name_ only:

```json
"credentials": { "gmailOAuth2": { "name": "Gmail account" } }
```

Every credential is created by the person running it, in their own n8n instance,
against their own Google project. Cloning this repository grants access to nothing.

**Configuration is placeholders.** Per-account values live in a `Config` node and
are rewritten to the placeholders declared in `manifest.json` on every export, so a
maintainer's real address cannot reach the repo even by accident
([ADR-0004](docs/adr/0004-config-node-over-env-vars.md)).

## Never commit these

| Path                 | Why                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `infra/data/`        | Contains `database.sqlite` — every credential, encrypted — and `config`, the key that decrypts them |
| `infra/data/config`  | The encryption key. Committing this alongside the database exposes every stored secret              |
| `infra/.env`         | Encryption key, API key, database password                                                          |
| `*.credentials.json` | Output of a decrypted credential export                                                             |

All are covered by `.gitignore`, and `.gitleaks.toml` blocks the same shapes as a
second layer. Do not rely on either alone.

## Never run this

```bash
n8n export:credentials --decrypted    # writes PLAINTEXT secrets to disk
```

There is no legitimate use for it here. `make export` uses the workflow API, which
returns definitions only and cannot read credential values.

## Layered defences

1. **`.gitignore`** — written before any other file in this repo, so nothing
   sensitive was ever tracked.
2. **Deterministic sanitisation** — `tooling/lib/sanitize.mjs` strips credential
   ids, `versionId`, `webhookId`, `pinData`, `staticData` (polling cursors), and
   `shared` (which embeds the owning project name, and with it the owner's email
   address — the field most likely to leak PII on a naive export).
3. **Validation** — `make validate` fails on any real email address, any
   `Label_<digits>` literal, any credential id, and any Config field without a
   declared placeholder.
4. **Tests** — the same properties are asserted in `tooling/tests/shared.test.mjs`
   for every workflow, automatically.
5. **CI** — gitleaks scans the **full history** on every push, because a secret
   removed from `HEAD` is still a leaked secret.

## If a secret is committed

Rotating comes first. Removing it from history does not un-leak it — assume
anything pushed to a public repository has been scraped.

1. **Revoke immediately.** Delete the Gemini key in AI Studio; revoke the OAuth
   client in Google Cloud → Credentials.
2. **Rotate the encryption key** if `infra/data/config` or `N8N_ENCRYPTION_KEY` was
   exposed — procedure in [OPERATIONS.md](docs/OPERATIONS.md#rotating-the-encryption-key).
3. **Recreate the credentials** in n8n under the same names. Because binding is by
   name, workflows keep working with no edits.
4. **Purge history** with `git filter-repo` and force-push, then ask GitHub Support
   to expire cached views.
5. **Add a gitleaks rule** for the shape that got through, so it cannot recur.

## Scope of the automations

Worth knowing before you activate anything:

- **Gmail scopes** are `gmail.modify`, `gmail.compose`, `gmail.labels`. No workflow
  here deletes mail, and `https://mail.google.com/` (full account access) is never
  requested.
- **Replies are drafts, never sent.** The model writes; a human sends.
- **Spam is labelled, not moved.** The system `SPAM` label is deliberately unused —
  it would hide real mail on a false positive _and_ train Gmail's own filter on the
  mistake ([ADR-0001](workflows/email-ai-classifier/docs/adr/0001-custom-ai-spam-label.md)).
- **Email content is sent to Google's Gemini API** for classification. Do not point
  this at a mailbox whose contents you cannot share with a third-party LLM.
- **`N8N_BLOCK_ENV_ACCESS_IN_NODE` stays enabled.** No workflow here needs env
  access, so the secure default is kept.

## Supported versions

The tip of `main`, against the n8n version pinned in
`infra/docker-compose.yml` (currently `2.23.4`).
