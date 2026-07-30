# Operations

Running this after it works. Backup, upgrade, recovery, and the round-trip between
n8n and the repo.

## The round-trip

The repo is the source of truth for workflow **structure**; the running n8n
instance is where you actually edit. Two commands move between them.

```bash
make export                          # n8n → repo (sanitised)
make export WORKFLOW=email-ai-classifier

make import                          # repo → n8n
make import-dry                      # preview
```

Export is **safe to run any time**. It strips instance state and rewrites Config
values back to placeholders, so real values cannot reach the repo even if you
forget they were there.

Import **overwrites** the workflow in n8n when the manifest has an `n8nId`. It
does not touch credentials.

### Normal edit cycle

```bash
# 1. edit on the canvas in n8n
make export          # 2. pull the change in
make check           # 3. validate, test, confirm docs are current
git add -A && git commit
```

If `make export` reports changes you did not make, that is usually a Config value
being normalised back to its placeholder — which is the system working.

### Why export produces no diff when nothing changed

Sanitisation is deterministic: keys are sorted, instance fields removed, config
values replaced. A test asserts the committed file is byte-identical to what
sanitise produces, so a spurious diff means something genuinely changed.

## Backup

```bash
make backup                    # → ../n8n-backups/n8n-data-<timestamp>.tar.gz
sh infra/backup.sh /some/path  # custom destination
```

The script stops n8n first so SQLite is not archived mid-write, then restarts it.
It keeps the 10 most recent archives.

### Two things must be backed up, and they fail differently

| What                 | Contains                                             | If you lose it                                                      |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| `infra/data/`        | Workflows, executions, credentials **as ciphertext** | Recoverable — workflows are in git                                  |
| `N8N_ENCRYPTION_KEY` | The only thing that decrypts those credentials       | **Unrecoverable** — every OAuth token and API key must be recreated |

A backup of `data/` without the key cannot restore credentials. Keep the key in a
password manager, not in the archive and not on the same disk.

If `infra/data/config` exists, the key was auto-generated and that file is its only
copy. Move it into `infra/.env`:

```bash
cat infra/data/config          # → {"encryptionKey":"..."}
```

## Restore

```bash
make down
rm -rf infra/data && mkdir -p infra/data
tar -xzf ../n8n-backups/n8n-data-<timestamp>.tar.gz -C infra/data
# ensure infra/.env has the SAME N8N_ENCRYPTION_KEY as when the backup was taken
make up
```

Wrong key: n8n starts, workflows are all there, and every credential fails to
decrypt. Restore the key, or recreate the credentials by name.

Lost everything except git? `make up` on an empty data dir, recreate the
credentials with the names in [CREDENTIALS.md](CREDENTIALS.md), then `make import`.
Structure and documentation are fully recoverable — only the secrets are not.

## Rotating the encryption key

There is no in-place rotation. The procedure is a re-key:

1. `make backup`
2. Note every credential's name and type (`docs/CREDENTIALS.md` lists the required
   ones).
3. `make export` — confirm the repo is current.
4. `make down`, set the new key in `infra/.env`, move `infra/data` aside.
5. `make up`, recreate the owner account and each credential under the same name.
6. `make import`.

Because credentials bind by name, step 6 rewires everything automatically.

## Upgrading n8n

The image is pinned in `infra/docker-compose.yml`, deliberately —
[ADR-0001](adr/0001-monorepo-layout.md).

```bash
make backup
# edit infra/docker-compose.yml: image: n8nio/n8n:<new version>
make up          # recreates the container
make logs        # watch for migration errors
make check
```

Then open each workflow and confirm it still validates in the UI.

**Read the breaking changes for major versions.** n8n 2.0 blocked `$env` access in
nodes by default, which silently breaks any workflow relying on it — this repo
sidesteps that entirely by keeping config in a Config node
([ADR-0004](adr/0004-config-node-over-env-vars.md)), but a workflow imported from
elsewhere may not.

If the upgrade misbehaves, revert the pin and restore the backup. Downgrading
across a schema migration does not work without the backup.

## Switching to Postgres

```bash
make export                                  # repo must be current
# set POSTGRES_PASSWORD in infra/.env
make down
mv infra/data infra/data.sqlite-backup
make up-prod
# recreate owner + credentials, then:
make import
```

SQLite data does **not** migrate automatically; the workflows come from git and the
credentials are recreated. Keep the old directory until you have confirmed
everything works.

## Housekeeping

Execution history is pruned automatically after `EXECUTIONS_DATA_MAX_AGE` hours
(default 336 = 14 days). If `infra/data` grows unexpectedly, that is usually
execution data — lower the value and restart.

```bash
make ps          # container status
make logs        # tail
make shell       # shell inside the container
du -sh infra/data
```

## Adding a workflow

```bash
make new-workflow SLUG=slack-digest
```

Build it in n8n, put its id in the new `manifest.json`, then:

```bash
make export WORKFLOW=slack-digest
make validate && make test && make readme
```

CI, the test matrix and the README index pick it up automatically — no pipeline
changes. Conventions: [CONVENTIONS.md](CONVENTIONS.md).
