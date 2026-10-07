#!/usr/bin/env bash

# Standalone tests for check-hook-parity.sh. Each test builds a tiny fake
# repo in a temp dir (package.json, lefthook.yml and one PR workflow) and
# asserts the check passes or fails with a useful message.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-hook-parity.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# A fake repo where the hooks and CI run the same checks.
create_repo() {
  local repo="$1"

  mkdir -p "$repo/.github/workflows"
  cat > "$repo/package.json" <<'JSON'
{
  "scripts": {
    "verify": "turbo run lint test",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "test:sbom": "node --test .github/actions/sbom-*/*.test.mjs"
  }
}
JSON
  cat > "$repo/lefthook.yml" <<'YAML'
pre-commit:
  jobs:
    - name: verify
      glob:
        - "apps/**"
      run: mise x -- pnpm verify --affected
    - name: sbom action tests
      run: mise x -- pnpm test:sbom
YAML
  cat > "$repo/.github/workflows/ci.yml" <<'YAML'
on:
  pull_request:
jobs:
  ci:
    steps:
      - uses: actions/checkout@v5
      - run: pnpm install --frozen-lockfile
      - name: Lint
        run: pnpm lint
      - name: Test
        run: pnpm test
      - name: Test SBOM actions
        run: node --test .github/actions/sbom-*/*.test.mjs
YAML
}

# Appends a step to the fake workflow.
add_ci_step() {
  printf '%s\n' "$2" >> "$1/.github/workflows/ci.yml"
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

test_fails_on_unknown_node_step() {
  local repo="$TEST_TMP/node-step"
  create_repo "$repo"
  add_ci_step "$repo" '      - name: Other tests
        run: node --test scripts/*.test.mjs'

  expect_failure "$repo" node-step "ci.yml: Other tests runs \`node --test scripts/*.test.mjs\`, which matches no check"
}

test_fails_on_npx_step() {
  local repo="$TEST_TMP/npx-step"
  create_repo "$repo"
  add_ci_step "$repo" '      - run: npx eslint .'

  expect_failure "$repo" npx-step "ci.yml: npx eslint . runs"
}

test_fails_on_pnpm_filter_step() {
  local repo="$TEST_TMP/pnpm-filter"
  create_repo "$repo"
  add_ci_step "$repo" '      - name: Build web
        run: pnpm --filter web build'

  expect_failure "$repo" pnpm-filter "ci.yml: Build web runs"
}

test_fails_on_unknown_block_step() {
  local repo="$TEST_TMP/block-step"
  create_repo "$repo"
  add_ci_step "$repo" '      - name: Scripted check
        run: |
          set -e
          ./bin/custom-check'

  expect_failure "$repo" block-step "ci.yml: Scripted check runs \`set -e ; ./bin/custom-check\`"
}

test_fails_on_unlisted_local_action() {
  local repo="$TEST_TMP/local-action"
  create_repo "$repo"
  add_ci_step "$repo" '      - name: Custom checks
        uses: ./.github/actions/custom-checks'

  expect_failure "$repo" local-action "./.github/actions/custom-checks (local action)"
}

test_passes_on_listed_local_action() {
  local repo="$TEST_TMP/listed-action"
  create_repo "$repo"
  add_ci_step "$repo" '      - uses: ./.github/actions/setup # toolchain'

  expect_pass "$repo" listed-action
}

test_fails_when_hook_skips_script_ci_runs_by_body() {
  local repo="$TEST_TMP/missing-sbom-hook"
  create_repo "$repo"
  perl -0pi -e 's/    - name: sbom action tests\n      run: mise x -- pnpm test:sbom\n//' "$repo/lefthook.yml"

  expect_failure "$repo" missing-sbom-hook "CI runs 'test:sbom' but no git hook does"
}

test_fails_when_hook_runs_check_ci_skips() {
  local repo="$TEST_TMP/hook-only"
  create_repo "$repo"
  perl -0pi -e 's/      - name: Lint\n        run: pnpm lint\n//' "$repo/.github/workflows/ci.yml"

  expect_failure "$repo" hook-only "a git hook runs 'lint' but no pull_request workflow does"
}

test_ignores_workflows_without_pull_request() {
  local repo="$TEST_TMP/push-only"
  create_repo "$repo"
  cat > "$repo/.github/workflows/deploy.yml" <<'YAML'
on:
  push:
jobs:
  deploy:
    steps:
      - run: az login
YAML

  expect_pass "$repo" push-only
}

test_passes_on_real_repo() {
  expect_pass "$SCRIPT_DIR/../.." real
}

tests=(
  test_passes_when_everything_matches
  test_fails_on_unknown_node_step
  test_fails_on_npx_step
  test_fails_on_pnpm_filter_step
  test_fails_on_unknown_block_step
  test_fails_on_unlisted_local_action
  test_passes_on_listed_local_action
  test_fails_when_hook_skips_script_ci_runs_by_body
  test_fails_when_hook_runs_check_ci_skips
  test_ignores_workflows_without_pull_request
  test_passes_on_real_repo
)

for test_name in "${tests[@]}"; do
  "$test_name"
  echo "PASS: $test_name"
done

echo "All ${#tests[@]} hook-parity tests passed."
