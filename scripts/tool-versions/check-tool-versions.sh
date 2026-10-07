#!/usr/bin/env bash

# mise.toml is the single source of truth for tool versions. A few files
# can't read it directly (Dockerfiles, docker-compose commands, and
# package.json's packageManager and engines fields), so they keep a copy of
# the version. This check fails if any copy drifts from mise.toml, if a pnpm
# version is hardcoded anywhere else, or if a GitHub workflow/action sets up
# Node/pnpm on its own instead of using jdx/mise-action.
#
# Usage: check-tool-versions.sh [repo-root]  (defaults to this repo)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${1:-${SCRIPT_DIR}/../..}" && pwd)"
ERRORS=0

error() {
  echo "ERROR: $*" >&2
  ERRORS=$((ERRORS + 1))
}

# Reads `<tool> = "<version>"` from mise.toml's [tools] table.
mise_version() {
  local tool="$1"
  sed -n "s/^${tool}[[:space:]]*=[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$ROOT/mise.toml" | head -n1
}

# Files we scan by walking the tree. Skips installed deps, build output and
# nested checkouts (e.g. git worktrees under .claude/). Paths are
# NUL-separated so names with spaces survive xargs/read.
find_files() {
  find "$ROOT" \
    \( -name node_modules -o -name .git -o -name .claude -o -name .turbo -o -name dist \) -prune -o \
    -type f \( "$@" \) -print0
}

if [ ! -f "$ROOT/mise.toml" ]; then
  echo "ERROR: $ROOT/mise.toml not found" >&2
  exit 1
fi

NODE_VERSION="$(mise_version node)"
PNPM_VERSION="$(mise_version pnpm)"
TERRAFORM_VERSION="$(mise_version terraform)"

[ -n "$NODE_VERSION" ] || error "mise.toml has no node pin"
[ -n "$PNPM_VERSION" ] || error "mise.toml has no pnpm pin"
[ -n "$TERRAFORM_VERSION" ] || error "mise.toml has no terraform pin"

if [ -n "$PNPM_VERSION" ]; then
  # The root package.json must pin pnpm; corepack and turbo read it there.
  grep -qF "\"packageManager\": \"pnpm@${PNPM_VERSION}\"" "$ROOT/package.json" ||
    error "package.json packageManager does not match mise.toml pnpm ${PNPM_VERSION}"
  grep -qF "\"pnpm\": \"${PNPM_VERSION}\"" "$ROOT/package.json" ||
    error "package.json engines.pnpm does not match mise.toml pnpm ${PNPM_VERSION}"

  # Any other package.json that sets packageManager must agree too.
  while IFS= read -r -d '' pkg; do
    [ "$pkg" != "$ROOT/package.json" ] || continue
    grep -q '"packageManager"' "$pkg" || continue
    grep -qF "\"packageManager\": \"pnpm@${PNPM_VERSION}\"" "$pkg" ||
      error "${pkg#"$ROOT"/} packageManager does not match mise.toml pnpm ${PNPM_VERSION}"
  done < <(find_files -name package.json)

  # A literal pnpm@x, pnpm@x.y or pnpm@x.y.z anywhere in yml/sh (e.g.
  # `corepack prepare`) is a copy nobody will remember to bump. The whole
  # selector is captured so pnpm@10.30.3-rc.1 can't pass as pnpm@10.30.3.
  while IFS= read -r match; do
    error "${match#"$ROOT"/} hardcodes pnpm (mise.toml pins ${PNPM_VERSION})"
  done < <(find_files \( -name '*.yml' -o -name '*.yaml' -o -name '*.sh' \) \
    ! -name pnpm-lock.yaml ! -path '*/scripts/tool-versions/*' |
    xargs -0 grep -HnoE 'pnpm@[0-9][0-9A-Za-z.+-]*' 2>/dev/null |
    grep -vE "pnpm@${PNPM_VERSION//./\\.}\$" || true)
fi

# engines.node allows patch/minor bumps (the Playwright e2e image ships its
# own Node 24.x) but rejects a different major, e.g. an old nvm Node.
if [ -n "$NODE_VERSION" ] &&
  ! grep -qF "\"node\": \"^${NODE_VERSION}\"" "$ROOT/package.json"; then
  error "package.json engines.node is not \"^${NODE_VERSION}\" (mise.toml node ${NODE_VERSION})"
fi

grep -qxF "engineStrict: true" "$ROOT/pnpm-workspace.yaml" 2>/dev/null ||
  error "pnpm-workspace.yaml must set engineStrict: true so package.json engines is enforced"

for dockerfile in apps/api/Dockerfile apps/web/Dockerfile Dockerfile.test; do
  [ -f "$ROOT/$dockerfile" ] || continue

  if [ -n "$NODE_VERSION" ] &&
    ! grep -qxF "ARG NODE_VERSION=${NODE_VERSION}" "$ROOT/$dockerfile"; then
    error "$dockerfile ARG NODE_VERSION does not match mise.toml node ${NODE_VERSION}"
  fi
  if [ -n "$PNPM_VERSION" ] &&
    ! grep -qxF "ARG PNPM_VERSION=${PNPM_VERSION}" "$ROOT/$dockerfile"; then
    error "$dockerfile ARG PNPM_VERSION does not match mise.toml pnpm ${PNPM_VERSION}"
  fi
done

while IFS= read -r match; do
  error "${match#"$ROOT"/} (use jdx/mise-action so versions come from mise.toml)"
done < <(find "$ROOT/.github/workflows" "$ROOT/.github/actions" -type f \( -name '*.yml' -o -name '*.yaml' \) -print0 2>/dev/null |
  xargs -0 grep -HnE 'node-version:|actions/setup-node|pnpm/action-setup|hashicorp/setup-terraform' 2>/dev/null || true)

if [ "$ERRORS" -gt 0 ]; then
  echo "Tool versions drifted from mise.toml (${ERRORS} problem(s))." >&2
  exit 1
fi

echo "Tool versions match mise.toml (node ${NODE_VERSION}, pnpm ${PNPM_VERSION}, terraform ${TERRAFORM_VERSION})."
