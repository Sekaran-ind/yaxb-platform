#!/usr/bin/env bash
# Run before yaxb-box starts (ExecStartPre). If the database file is missing -- a new box or a
# replaced SD card -- restore it from Litestream's replica. Refuses to start with an empty database
# when the backup drive isn't mounted, because that's usually a new card without its backup.
set -euo pipefail
set -a
# shellcheck disable=SC1091
. /etc/yaxb-box/yaxb-box.env
set +a

DB_DIR="$(dirname "$YAXB_BOX_DB")"
mkdir -p "$DB_DIR"

if [ ! -e "$YAXB_BOX_DB" ]; then
  if ! mountpoint -q "$YAXB_BACKUP_DIR"; then
    echo "restore-if-empty: $YAXB_BACKUP_DIR is not mounted; refusing to start with an empty database" >&2
    echo "restore-if-empty: mount the backup drive (README), or start empty on purpose: sudo -u yaxbbox touch $YAXB_BOX_DB" >&2
    exit 1
  fi
  /usr/bin/litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists "$YAXB_BOX_DB"
fi

chown -R yaxbbox:yaxbbox "$DB_DIR"
