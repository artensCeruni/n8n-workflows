#!/bin/sh
# Back up the n8n data directory and, separately, the encryption key.
#
#   sh infra/backup.sh [destination-directory]
#
# Two things are backed up because they fail differently:
#
#   • data/       — workflows, executions, and credentials *as ciphertext*
#   • the key     — the only thing that can decrypt those credentials
#
# A backup of data/ without the key is useless for credential recovery, and n8n
# stores the key inside data/config only when it was never set explicitly. Keep
# the key somewhere other than the archive: a password manager, not the same disk.
#
# Backups land outside the repository by default. Never commit them.

set -eu

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA_DIR="$REPO_ROOT/infra/data"
DEST=${1:-"$REPO_ROOT/../n8n-backups"}
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$DEST/n8n-data-$STAMP.tar.gz"

if [ ! -d "$DATA_DIR" ]; then
  echo "error: no data directory at $DATA_DIR — has n8n ever started?" >&2
  exit 1
fi

mkdir -p "$DEST"

echo "Stopping n8n so SQLite is not mid-write..."
STOPPED=0
if docker compose -f "$REPO_ROOT/infra/docker-compose.yml" ps --status running 2>/dev/null | grep -q n8n; then
  docker compose -f "$REPO_ROOT/infra/docker-compose.yml" stop n8n
  STOPPED=1
else
  echo "  (n8n was not running)"
fi

echo "Archiving $DATA_DIR ..."
tar -czf "$ARCHIVE" -C "$DATA_DIR" .

if [ "$STOPPED" -eq 1 ]; then
  echo "Restarting n8n..."
  docker compose -f "$REPO_ROOT/infra/docker-compose.yml" start n8n
fi

echo ""
echo "Backup written: $ARCHIVE"
echo ""

if [ -f "$DATA_DIR/config" ]; then
  echo "NOTE: data/config exists, which means N8N_ENCRYPTION_KEY was never set"
  echo "      explicitly. Move that key into infra/.env and store a copy in a"
  echo "      password manager — right now this archive is its only backup, and"
  echo "      losing it makes every stored credential unrecoverable."
  echo ""
fi

echo "Retaining the 10 most recent archives in $DEST"
ls -1t "$DEST"/n8n-data-*.tar.gz 2>/dev/null | tail -n +11 | while read -r old; do
  echo "  removing $(basename "$old")"
  rm -f "$old"
done
