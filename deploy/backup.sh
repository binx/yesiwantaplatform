#!/usr/bin/env bash
# Nightly SQLite backup, run by postcards-backup.timer as the postcards user.
#
# `.backup` takes a consistent copy while the server keeps writing (WAL mode),
# unlike cp. Fourteen days are kept. Uploaded imagery is not copied here — it
# is covered by the droplet's own weekly backups, and a design's print file
# is deleted once every card of it has gone to Lob anyway.

set -euo pipefail

DB=/srv/postcards/data/postcards.sqlite
DIR=/srv/postcards/backups
KEEP=14

mkdir -p "$DIR"
stamp=$(date +%Y-%m-%d)
sqlite3 "$DB" ".backup '$DIR/postcards-$stamp.sqlite'"
gzip -f "$DIR/postcards-$stamp.sqlite"

# Prune, oldest first.
ls -1t "$DIR"/postcards-*.sqlite.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
echo "Backed up $DB to $DIR/postcards-$stamp.sqlite.gz"
