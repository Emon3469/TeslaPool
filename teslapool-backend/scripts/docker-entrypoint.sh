#!/bin/sh
# Container start: migrate (with retries, the DB may still be booting) -> optional seed -> exec the server.
# `exec` makes node PID 1's direct child target for SIGTERM, so graceful shutdown works on Render/Docker.
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  attempt=1
  max="${MIGRATE_MAX_ATTEMPTS:-15}"
  until ./node_modules/.bin/prisma migrate deploy; do
    if [ "$attempt" -ge "$max" ]; then
      echo "prisma migrate deploy failed after $attempt attempts" >&2
      exit 1
    fi
    echo "Database not ready (attempt $attempt/$max); retrying in 3s..." >&2
    attempt=$((attempt + 1))
    sleep 3
  done
fi

if [ "${SEED_ON_START:-false}" = "true" ]; then
  node dist/prisma/seed.js
fi

exec node dist/src/main.js
