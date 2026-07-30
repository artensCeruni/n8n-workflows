# Credentials

Nothing in this repository contains a secret, and nothing here can be used to
access anyone else's account. Every credential is created by you, in your own n8n
instance, against your own Google project.

## How binding works

An exported workflow references a credential by **name only**:

```json
"credentials": { "gmailOAuth2": { "name": "Gmail account" } }
```

n8n normally stores `{ id, name }`, where `id` points at a row in _that_
instance's database. `tooling/lib/sanitize.mjs` strips the id on export, which has
two effects:

- Nothing instance-specific reaches the repo.
- The **name becomes a public contract**. Create a credential with the name below
  and `make import` binds it automatically — no clicking through nodes.

Get the name wrong and the node imports unconfigured. `make validate` catches a
mismatch between the workflow and the manifest, but it cannot know what you named
things inside n8n, so copy the names exactly.

## Required credentials

| Type            | Name to create                    | Needed by                                                |
| --------------- | --------------------------------- | -------------------------------------------------------- |
| `gmailOAuth2`   | `Gmail account`                   | [email-ai-classifier](../workflows/email-ai-classifier/) |
| `googlePalmApi` | `Google Gemini(PaLM) Api account` | [email-ai-classifier](../workflows/email-ai-classifier/) |

## Gmail OAuth2

The Gmail node needs an OAuth2 client from your own Google Cloud project. Google
does not allow a shared client for this, which is why it cannot be pre-configured.

1. **Create a project** — [console.cloud.google.com](https://console.cloud.google.com/)
   → new project.
2. **Enable the Gmail API** — APIs & Services → Library → _Gmail API_ → Enable.
3. **Configure the consent screen** — External is fine. While the app is in
   _Testing_, add your own address under **Test users**, or OAuth will refuse.
4. **Create credentials** — APIs & Services → Credentials → Create → _OAuth client
   ID_ → **Web application**.
5. **Add the redirect URI.** Copy it from the n8n credential screen — n8n shows
   the exact value. For a local install it is:

   ```
   http://localhost:5678/rest/oauth2-credential/callback
   ```

   It must match character for character, including the port. If you changed
   `N8N_PORT`, use the new port.

6. **In n8n** — Credentials → New → _Gmail OAuth2 API_. Name it exactly
   `Gmail account`. Paste the client id and secret, then **Sign in with Google**.

### Scopes

| Scope           | Why                                                       |
| --------------- | --------------------------------------------------------- |
| `gmail.modify`  | Read messages, mark as read, add labels                   |
| `gmail.compose` | Create draft replies                                      |
| `gmail.labels`  | List labels, so the bootstrap node can find your label id |

`gmail.modify` covers reading and mutating messages but **not** permanent
deletion, which suits this repo: no workflow here deletes mail
([ADR-0001](../workflows/email-ai-classifier/docs/adr/0001-custom-ai-spam-label.md)).
Do not grant `https://mail.google.com/` — it is full account access and nothing
here needs it.

### Refresh token expiry

While the consent screen is in _Testing_, Google expires refresh tokens after
**7 days**. If a workflow starts failing with `invalid_grant` about a week after
setup, that is why. Publish the app (Consent screen → _Publish app_) to stop it;
for a single-user internal tool no verification review is required.

## Google Gemini API key

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
   create a key.
2. In n8n → Credentials → New → _Google Gemini(PaLM) API_. Name it exactly
   `Google Gemini(PaLM) Api account` and paste the key.

Free-tier quota is per model, not per account. The 2.0 series has no usable free
allowance on the key this repo was built against, which is why workflows pin
`models/gemini-2.5-flash` —
[ADR-0003](../workflows/email-ai-classifier/docs/adr/0003-gemini-2-5-flash.md).

## The encryption key

n8n encrypts stored credentials with `N8N_ENCRYPTION_KEY`. If you never set it,
n8n generates one into `infra/data/config` on first boot — making that file the
only thing that can decrypt your credentials.

Set it explicitly in `infra/.env` and keep a copy in a password manager:

```bash
openssl rand -base64 32
```

**Already running n8n?** Do not generate a new key. Copy the existing one out
first, or n8n will not be able to read the credentials it already has:

```bash
cat infra/data/config     # → {"encryptionKey":"..."}
```

Rotation and recovery: [OPERATIONS.md](OPERATIONS.md).

## Rules

- **Never run `n8n export:credentials --decrypted`.** It writes plaintext secrets
  to disk. `n8n export:workflow` — what `make export` uses — does not.
- **Never commit `infra/data/` or `infra/.env`.** Both are git-ignored;
  `.gitleaks.toml` blocks the shapes at commit time as a second layer.
- **Credential values never live in this repo**, in any form, encrypted or not.
  Only names.

If you believe a secret was committed, see [SECURITY.md](../SECURITY.md).
