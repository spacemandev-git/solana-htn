#!/bin/sh
set -e
# Restore whatever the last instance replicated. -if-replica-exists makes the
# very first boot (empty bucket) a no-op instead of a crash.
litestream restore -if-replica-exists -config /etc/litestream.yml /tmp/badge.db
# Hand the app to litestream so replication runs for the process's lifetime.
exec litestream replicate -config /etc/litestream.yml \
  -exec "bun run apps/badge-service/src/index.ts"
