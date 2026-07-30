# Setup

From nothing to a running, imported workflow. Roughly 15 minutes, most of it
Google's OAuth screens.

## Prerequisites

| Tool             | Version | Check                    |
| ---------------- | ------- | ------------------------ |
| Docker + Compose | v2      | `docker compose version` |
| Node.js          | ≥ 20.6  | `node --version`         |
| make             | any     | `make --version`         |

Node is only needed for the tooling (`export`, `import`, `validate`, tests) — n8n
itself runs in Docker.

## 1. Clone and configure

```bash
git clone https://github.com/<you>/n8n-workflows.git
cd n8n-workflows
npm install

cp infra/.env.example infra/.env
```

Open `infra/.env` and set the one required value:

```bash
# Generate a fresh key
openssl rand -base64 32
```

> **Already running another n8n instance whose credentials you want to keep?**
> Do not generate a new key — copy the existing one from that instance's
> `config` file instead, or n8n cannot decrypt the credentials it already has.
> Details in [CREDENTIALS.md](CREDENTIALS.md#the-encryption-key).

Port 5678 already taken? Set `N8N_PORT=5679` in the same file.

## 2. Start n8n

```bash
make up
make logs        # ctrl-c once you see the ready banner
```

Open <http://localhost:5678> and create the owner account. This is local to your
machine.

## 3. Create credentials

Workflows bind credentials **by name**, so the names have to match exactly.
Full walkthrough in [CREDENTIALS.md](CREDENTIALS.md).

| Type                    | Name — must match exactly         |
| ----------------------- | --------------------------------- |
| Gmail OAuth2 API        | `Gmail account`                   |
| Google Gemini(PaLM) API | `Google Gemini(PaLM) Api account` |

## 4. Get an API key for the tooling

n8n → **Settings → n8n API → Create an API key**. Put it in `infra/.env`:

```
N8N_API_KEY=<paste>
```

This key moves workflow definitions only. It cannot read credential secrets.

## 5. Import the workflows

```bash
make import-dry     # show what would happen
make import         # do it
```

Workflows arrive **inactive**, with placeholder configuration. That is
intentional — nothing starts touching your mailbox until you have reviewed it.

## 6. Fill in the Config nodes

Each workflow carries its settings in a `Config` node on the canvas rather than in
environment variables ([ADR-0004](adr/0004-config-node-over-env-vars.md)). Open
the workflow and edit it.

For **email-ai-classifier**:

| Node          | Field         | Set to                              |
| ------------- | ------------- | ----------------------------------- |
| `Config`      | `alertEmail`  | Where urgent alerts go              |
| `Config`      | `spamLabelId` | Your `AI/Spam` label id — see below |
| `Test Config` | `testInbox`   | An inbox the trigger watches        |

To find the label id: create an `AI/Spam` label in Gmail, then enable and run the
**Bootstrap: List Gmail Labels** node on the canvas. It lists every label with its
id. Disable it again afterwards.

## 7. Test before going live

Click **Inject Test Emails** on the canvas. It sends four emails — one per
category — to `testInbox`. The trigger picks them up and you can watch each one
route: alert, draft, draft, label.

Check that all four ended at `Mark as Processed`. If any did not, the message
stays unread and will be reprocessed every minute.

## 8. Activate

Toggle the workflow **Active** in n8n.

The Gmail trigger polls every minute **while the container is running**. This is
not a cloud scheduler — if the machine sleeps, nothing is processed until it wakes.

## Verify the whole thing

```bash
make check      # validate + README freshness + formatting + tests
```

## Common problems

| Symptom                                     | Cause                                                           | Fix                                                                                |
| ------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `N8N_ENCRYPTION_KEY is required`            | `infra/.env` missing or key unset                               | Step 1                                                                             |
| `Cannot reach n8n at http://localhost:5678` | Container not running                                           | `make up`                                                                          |
| `N8N_API_KEY is not set`                    | Step 4 skipped                                                  | Create the key in Settings → n8n API                                               |
| Nodes import with "credential not set"      | Credential name does not match                                  | Rename to the exact strings in step 3                                              |
| `invalid_grant` about a week after setup    | Google expires refresh tokens for unpublished apps after 7 days | Publish the consent screen ([CREDENTIALS.md](CREDENTIALS.md#refresh-token-expiry)) |
| Port already allocated                      | Another n8n on 5678                                             | Set `N8N_PORT` in `infra/.env`                                                     |

Day-to-day operations — backup, upgrade, key rotation — are in
[OPERATIONS.md](OPERATIONS.md).
