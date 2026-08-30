#!/bin/sh
# Fix ownership of mounted volumes so the node user can write to them
# Runs as root briefly, then drops to node user via exec
set -e

chown -R node:node /app/data /app/logs 2>/dev/null || true

exec su-exec node "$@"
