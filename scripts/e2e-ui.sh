#!/usr/bin/env bash
# Runs Playwright's interactive UI mode locally (not in Docker - it needs
# a display). Expects the web and api dev servers to already be running,
# e.g. via `pnpm dev:no-docker` in another terminal.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${BASE_URL:=http://localhost:5173}"
: "${API_URL:=http://localhost:8000}"

export BASE_URL API_URL

pnpm exec playwright test --ui
