#!/usr/bin/env bash

# Starts the Preloop engine (`preloop serve`) with its Linux guest runner.
#
#   pnpm ci:serve            leave it running, then `pnpm ci:local` elsewhere
#
# The engine runs each job in a Linux microVM, and needs the `preloop-runner`
# binary to put inside it. Preloop's own install.sh downloads that binary as a
# separate release asset, but `mise install` only fetches the CLI, so without
# this script the engine starts with "no runner pool" and jobs sit queued
# forever. This downloads the runner matching the installed CLI version,
# verifies its sha256, keeps it under ~/.preloop (or $PRELOOP_HOME), and points
# the engine at it with PRELOOP_RUNNER_BUNDLE. Arguments go to `preloop serve`.
#
# It also turns on a warm pool of one runner, so a VM is already booted when
# `pnpm ci:local` queues a job. Without it the engine boots a VM only after a
# job is queued, and every run waits through a cold boot of the runner image.
# Set PRELOOP_RUNNER_POOL_ENABLED=false or another PRELOOP_RUNNER_POOL_SIZE to
# change that.
#
# Written for bash 3.2 too (the default /bin/bash on macOS).

set -euo pipefail

RELEASES="${PRELOOP_RELEASES_URL:-https://github.com/preloopdev/preloop/releases/download}"
PRELOOP_DIR="${PRELOOP_HOME:-$HOME/.preloop}"

die() {
  echo "ci:serve: $*" >&2
  exit 1
}

command -v preloop >/dev/null 2>&1 ||
  die "Preloop isn't installed (no \`preloop\` on PATH). Run \`mise install\` first."

VERSION="$(preloop version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[ -n "$VERSION" ] || die "couldn't read a version from \`preloop version\`."

# The runner has to match the CLI that runs, so a drift from the pin is only
# a warning. It usually means `preloop update` or another install shadows mise.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$ROOT" ] && [ -f "$ROOT/mise.toml" ]; then
  PINNED="$(sed -nE 's/^"github:preloopdev\/preloop"[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$ROOT/mise.toml")"
  if [ -n "$PINNED" ] && [ "$PINNED" != "$VERSION" ]; then
    echo "ci:serve: warning: \`preloop\` on PATH is $VERSION but mise.toml pins $PINNED ($(command -v preloop))." >&2
  fi
fi

# Jobs always run in Linux VMs, on macOS too, so it's the Linux runner for the
# host's CPU.
case "$(uname -m)" in
  x86_64 | amd64) TRIPLE="x86_64-unknown-linux-gnu" ;;
  arm64 | aarch64) TRIPLE="aarch64-unknown-linux-gnu" ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

BUNDLE="$PRELOOP_DIR/runner/v$VERSION/$TRIPLE"
if [ ! -x "$BUNDLE/preloop-runner" ]; then
  ASSET="preloop-runner-$TRIPLE"
  echo "ci:serve: downloading $ASSET v$VERSION"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$RELEASES/v$VERSION/$ASSET" -o "$TMP/$ASSET" ||
    die "couldn't download $RELEASES/v$VERSION/$ASSET"
  EXPECTED="$(curl -fsSL "$RELEASES/v$VERSION/$ASSET.sha256" | awk '{print $1}')" ||
    die "couldn't download the checksum for $ASSET"
  [ -n "$EXPECTED" ] || die "empty checksum for $ASSET"
  [ "$(sha256 "$TMP/$ASSET")" = "$EXPECTED" ] ||
    die "checksum mismatch for $ASSET, refusing to install it"
  mkdir -p "$BUNDLE"
  chmod 0755 "$TMP/$ASSET"
  mv "$TMP/$ASSET" "$BUNDLE/preloop-runner"
  echo "ci:serve: installed $BUNDLE/preloop-runner"
fi

export PRELOOP_RUNNER_BUNDLE="$BUNDLE"
export PRELOOP_RUNNER_POOL_ENABLED="${PRELOOP_RUNNER_POOL_ENABLED:-true}"
export PRELOOP_RUNNER_POOL_SIZE="${PRELOOP_RUNNER_POOL_SIZE:-1}"
exec preloop serve "$@"
