#!/usr/bin/env bash
# Runs the e2e suite headlessly in Docker, the way CI does. See
# .github/workflows/e2e.yml for the exact invocation.
set -uo pipefail

cd "$(dirname "$0")/.."

export HOST_UID="${UID:-$(id -u)}"
export HOST_GID="${GID:-$(id -g)}"

docker compose -f docker-compose-e2e.yml up \
  --build \
  --abort-on-container-exit \
  --exit-code-from playwright
status=$?

docker compose -f docker-compose-e2e.yml down -v

exit "$status"
