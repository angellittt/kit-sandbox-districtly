#!/usr/bin/env bash

# Standalone tests for check-tool-versions.sh. Each test builds a tiny fake
# repo in a temp dir (mise.toml + the files the check reads) and asserts the
# check passes or fails with a useful message.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-tool-versions.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# In-place edit that works with both GNU sed (Linux) and BSD sed (macOS),
# which disagree on the -i flag.
replace() {
  sed "$1" "$2" > "$2.tmp" && mv "$2.tmp" "$2"
}

# A fake repo where every file agrees with mise.toml.
create_repo() {
  local repo="$1"

  mkdir -p "$repo/.github/workflows" "$repo/.github/actions/setup" "$repo/apps/api" "$repo/apps/web"
  cat > "$repo/mise.toml" <<'TOML'
[tools]
node = "24.14.0"
pnpm = "10.30.3"
terraform = "1.9.8"
TOML
  cat > "$repo/package.json" <<'JSON'
{
  "packageManager": "pnpm@10.30.3",
  "engines": {
    "node": "^24.14.0",
    "pnpm": "10.30.3"
  }
}
JSON
  cat > "$repo/apps/api/package.json" <<'JSON'
{
  "name": "api"
}
JSON
  cat > "$repo/pnpm-workspace.yaml" <<'YAML'
packages:
  - "apps/*"
engineStrict: true
YAML
  for dockerfile in "$repo/apps/api/Dockerfile" "$repo/apps/web/Dockerfile"; do
    cat > "$dockerfile" <<'DOCKER'
ARG NODE_VERSION=24.14.0
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION=10.30.3
RUN corepack prepare pnpm@${PNPM_VERSION} --activate
DOCKER
  done
  cat > "$repo/Dockerfile.test" <<'DOCKER'
ARG NODE_VERSION=24.14.0
FROM node:${NODE_VERSION}-alpine
ARG PNPM_VERSION=10.30.3
RUN corepack prepare pnpm@${PNPM_VERSION} --activate
DOCKER
  cat > "$repo/docker-compose-e2e.yml" <<'YAML'
services:
  playwright:
    command: ["sh", "-c", "corepack prepare pnpm@10.30.3 --activate && corepack pnpm install"]
YAML
  cat > "$repo/.github/workflows/ci.yml" <<'YAML'
jobs:
  test:
    steps:
      - uses: ./.github/actions/setup
      - run: pnpm test
YAML
  cat > "$repo/.github/actions/setup/action.yml" <<'YAML'
runs:
  using: composite
  steps:
    - uses: jdx/mise-action@c2a87611a18de5b3828c5652fe268e992400cb5c # v4.3.0
YAML
}

run_check() {
  local repo="$1"
  local output_file="$2"

  set +e
  bash "$CHECK" "$repo" > "$output_file" 2>&1
  local status=$?
  set -e
  return "$status"
}

expect_pass() {
  local repo="$1"
  local name="$2"

  run_check "$repo" "$TEST_TMP/$name.out" ||
    fail "$name: expected check to pass, got: $(cat "$TEST_TMP/$name.out")"
}

# Expects the check to fail with output containing $3.
expect_failure() {
  local repo="$1"
  local name="$2"
  local expected="$3"

  if run_check "$repo" "$TEST_TMP/$name.out"; then
    fail "$name: expected check to fail"
  fi
  grep -qF -- "$expected" "$TEST_TMP/$name.out" ||
    fail "$name: expected output to contain '$expected', got: $(cat "$TEST_TMP/$name.out")"
}

test_passes_when_everything_matches() {
  local repo="$TEST_TMP/ok"
  create_repo "$repo"

  expect_pass "$repo" ok
}

test_fails_on_dockerfile_node_drift() {
  local repo="$TEST_TMP/node-drift"
  create_repo "$repo"
  replace 's/NODE_VERSION=24.14.0/NODE_VERSION=22.1.0/' "$repo/apps/api/Dockerfile"

  expect_failure "$repo" node-drift "apps/api/Dockerfile"
}

test_fails_on_dockerfile_pnpm_drift() {
  local repo="$TEST_TMP/pnpm-drift"
  create_repo "$repo"
  replace 's/PNPM_VERSION=10.30.3/PNPM_VERSION=9.0.0/' "$repo/Dockerfile.test"

  expect_failure "$repo" pnpm-drift "Dockerfile.test"
}

test_fails_on_dockerfile_wildcard_lookalike() {
  local repo="$TEST_TMP/dockerfile-dots"
  create_repo "$repo"
  replace 's/NODE_VERSION=24.14.0/NODE_VERSION=24x14x0/' "$repo/apps/web/Dockerfile"

  expect_failure "$repo" dockerfile-dots "apps/web/Dockerfile"
}

test_fails_on_package_manager_drift() {
  local repo="$TEST_TMP/pm-drift"
  create_repo "$repo"
  replace 's/pnpm@10.30.3/pnpm@10.0.0/' "$repo/package.json"

  expect_failure "$repo" pm-drift "packageManager"
}

test_fails_on_longer_version_with_same_prefix() {
  local repo="$TEST_TMP/prefix"
  create_repo "$repo"
  replace 's/pnpm@10.30.3"/pnpm@10.30.31"/' "$repo/package.json"

  expect_failure "$repo" prefix "package.json packageManager"
}

test_fails_on_workspace_package_manager_drift() {
  local repo="$TEST_TMP/workspace-pm"
  create_repo "$repo"
  cat > "$repo/apps/api/package.json" <<'JSON'
{
  "name": "api",
  "packageManager": "pnpm@10.30.2"
}
JSON

  expect_failure "$repo" workspace-pm "apps/api/package.json packageManager"
}

test_passes_on_matching_workspace_package_manager() {
  local repo="$TEST_TMP/workspace-pm-ok"
  create_repo "$repo"
  cat > "$repo/apps/api/package.json" <<'JSON'
{
  "name": "api",
  "packageManager": "pnpm@10.30.3"
}
JSON

  expect_pass "$repo" workspace-pm-ok
}

test_ignores_package_json_in_node_modules() {
  local repo="$TEST_TMP/node-modules"
  create_repo "$repo"
  mkdir -p "$repo/node_modules/dep"
  echo '{ "packageManager": "pnpm@8.0.0" }' > "$repo/node_modules/dep/package.json"

  expect_pass "$repo" node-modules
}

test_fails_on_hardcoded_pnpm_in_yaml() {
  local repo="$TEST_TMP/compose-pnpm"
  create_repo "$repo"
  cat > "$repo/docker-compose-e2e.yml" <<'YAML'
services:
  e2e:
    command: ["sh", "-c", "corepack prepare pnpm@10.30.2 --activate"]
YAML

  expect_failure "$repo" compose-pnpm "docker-compose-e2e.yml:3"
}

test_fails_on_hardcoded_pnpm_in_shell_script() {
  local repo="$TEST_TMP/script-pnpm"
  create_repo "$repo"
  mkdir -p "$repo/scripts"
  echo 'npm install -g pnpm@9.1.0' > "$repo/scripts/setup.sh"

  expect_failure "$repo" script-pnpm "scripts/setup.sh"
}

test_fails_on_short_pnpm_selector() {
  local repo="$TEST_TMP/short-pnpm"
  create_repo "$repo"
  mkdir -p "$repo/scripts"
  echo 'npm install -g pnpm@9' > "$repo/scripts/setup.sh"
  echo 'corepack prepare pnpm@10.30 --activate' > "$repo/scripts/setup-minor.sh"

  expect_failure "$repo" short-pnpm "scripts/setup.sh"
  grep -qF "scripts/setup-minor.sh" "$TEST_TMP/short-pnpm.out" ||
    fail "short-pnpm: expected output to mention scripts/setup-minor.sh"
}

test_fails_on_selector_that_starts_with_pin() {
  local repo="$TEST_TMP/pin-prefix"
  create_repo "$repo"
  mkdir -p "$repo/scripts"
  echo 'npm install -g pnpm@10.30.3.4' > "$repo/scripts/setup.sh"
  echo 'corepack prepare pnpm@10.30.3-rc.1 --activate' > "$repo/scripts/setup-rc.sh"

  expect_failure "$repo" pin-prefix "scripts/setup.sh"
  grep -qF "scripts/setup-rc.sh" "$TEST_TMP/pin-prefix.out" ||
    fail "pin-prefix: expected output to mention scripts/setup-rc.sh"
}

test_passes_on_exact_pinned_pnpm_in_script() {
  local repo="$TEST_TMP/pin-exact"
  create_repo "$repo"
  mkdir -p "$repo/scripts"
  echo 'corepack prepare pnpm@10.30.3 --activate' > "$repo/scripts/setup.sh"
  echo '    command: ["sh", "-c", "npm i -g pnpm@10.30.3"]' > "$repo/compose.yml"

  expect_pass "$repo" pin-exact
}

test_fails_on_hardcoded_pnpm_in_path_with_space() {
  local repo="$TEST_TMP/space-pnpm"
  create_repo "$repo"
  mkdir -p "$repo/infra/local dev"
  echo 'npm install -g pnpm@9.1.0' > "$repo/infra/local dev/setup.sh"

  expect_failure "$repo" space-pnpm "infra/local dev/setup.sh"
}

test_fails_on_workflow_setup_node_in_path_with_space() {
  local repo="$TEST_TMP/space-workflow"
  create_repo "$repo"
  cat > "$repo/.github/workflows/legacy ci.yml" <<'YAML'
jobs:
  test:
    steps:
      - uses: actions/setup-node@v6
YAML

  expect_failure "$repo" space-workflow "legacy ci.yml"
}

test_fails_on_engines_node_drift() {
  local repo="$TEST_TMP/engines-node"
  create_repo "$repo"
  replace 's/"node": "^24.14.0"/"node": ">=22"/' "$repo/package.json"

  expect_failure "$repo" engines-node "engines.node"
}

test_fails_on_engines_pnpm_drift() {
  local repo="$TEST_TMP/engines-pnpm"
  create_repo "$repo"
  replace 's/"pnpm": "10.30.3"/"pnpm": "10.29.0"/' "$repo/package.json"

  expect_failure "$repo" engines-pnpm "engines.pnpm"
}

test_fails_without_engine_strict() {
  local repo="$TEST_TMP/engine-strict"
  create_repo "$repo"
  replace '/^engineStrict/d' "$repo/pnpm-workspace.yaml"

  expect_failure "$repo" engine-strict "engineStrict"
}

test_fails_on_compose_pnpm_drift() {
  local repo="$TEST_TMP/compose-drift"
  create_repo "$repo"
  replace 's/pnpm@10.30.3/pnpm@9.0.0/' "$repo/docker-compose-e2e.yml"

  expect_failure "$repo" compose-drift "docker-compose-e2e.yml"
}

test_passes_on_compose_pnpm_followed_by_delimiter() {
  local repo="$TEST_TMP/compose-delim"
  create_repo "$repo"
  replace 's/pnpm@10.30.3 --activate/pnpm@10.30.3; corepack enable/' "$repo/docker-compose-e2e.yml"

  expect_pass "$repo" compose-delim
}

test_fails_on_compose_pnpm_non_literal_dots() {
  local repo="$TEST_TMP/compose-dots"
  create_repo "$repo"
  replace 's/pnpm@10.30.3/pnpm@10x30x3/' "$repo/docker-compose-e2e.yml"

  expect_failure "$repo" compose-dots "docker-compose-e2e.yml"
}

test_fails_on_hardcoded_workflow_node_version() {
  local repo="$TEST_TMP/workflow-node"
  create_repo "$repo"
  cat > "$repo/.github/workflows/legacy.yml" <<'YAML'
jobs:
  test:
    steps:
      - uses: actions/setup-node@v6
        with:
          node-version: "24.14.0"
YAML

  expect_failure "$repo" workflow-node "legacy.yml"
}

test_fails_on_workflow_pnpm_action_setup() {
  local repo="$TEST_TMP/workflow-pnpm"
  create_repo "$repo"
  cat > "$repo/.github/workflows/legacy.yml" <<'YAML'
jobs:
  test:
    steps:
      - uses: pnpm/action-setup@v6
YAML

  expect_failure "$repo" workflow-pnpm "legacy.yml"
}

test_fails_on_setup_node_in_composite_action() {
  local repo="$TEST_TMP/action-node"
  create_repo "$repo"
  cat > "$repo/.github/actions/setup/action.yml" <<'YAML'
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v6
YAML

  expect_failure "$repo" action-node ".github/actions/setup/action.yml"
}

test_fails_when_mise_toml_missing_a_tool() {
  local repo="$TEST_TMP/missing-tool"
  create_repo "$repo"
  replace '/^terraform/d' "$repo/mise.toml"

  expect_failure "$repo" missing-tool "terraform"
}

test_passes_on_real_repo() {
  expect_pass "$SCRIPT_DIR/../.." real
}

tests=(
  test_passes_when_everything_matches
  test_fails_on_dockerfile_node_drift
  test_fails_on_dockerfile_pnpm_drift
  test_fails_on_dockerfile_wildcard_lookalike
  test_fails_on_package_manager_drift
  test_fails_on_longer_version_with_same_prefix
  test_fails_on_workspace_package_manager_drift
  test_passes_on_matching_workspace_package_manager
  test_ignores_package_json_in_node_modules
  test_fails_on_hardcoded_pnpm_in_yaml
  test_fails_on_hardcoded_pnpm_in_shell_script
  test_fails_on_short_pnpm_selector
  test_fails_on_selector_that_starts_with_pin
  test_passes_on_exact_pinned_pnpm_in_script
  test_fails_on_hardcoded_pnpm_in_path_with_space
  test_fails_on_workflow_setup_node_in_path_with_space
  test_fails_on_engines_node_drift
  test_fails_on_engines_pnpm_drift
  test_fails_without_engine_strict
  test_fails_on_compose_pnpm_drift
  test_passes_on_compose_pnpm_followed_by_delimiter
  test_fails_on_compose_pnpm_non_literal_dots
  test_fails_on_hardcoded_workflow_node_version
  test_fails_on_workflow_pnpm_action_setup
  test_fails_on_setup_node_in_composite_action
  test_fails_when_mise_toml_missing_a_tool
  test_passes_on_real_repo
)

for test_name in "${tests[@]}"; do
  "$test_name"
  echo "PASS: $test_name"
done

echo "All ${#tests[@]} tool-version tests passed."
