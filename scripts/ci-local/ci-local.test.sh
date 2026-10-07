#!/usr/bin/env bash

# Standalone tests for ci-local.sh. Each test builds a tiny git repo in a temp
# dir with a few workflows, puts a fake `preloop` on PATH (it logs its
# arguments and fails on request), and checks what ci-local.sh ran, its exit
# code and the pass stamp.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CI_LOCAL="${SCRIPT_DIR}/ci-local.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

FAKE_BIN="$TEST_TMP/bin"
BASE_PATH="/usr/local/bin:/usr/bin:/bin"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Fake preloop: appends its args to $FAKE_LOG, minus the `--payload <file>`
# pair, and copies that file to $FAKE_LOG.payload. `run` fails for any workflow
# path containing $FAKE_FAIL; `doctor` fails when $FAKE_DOCTOR_FAIL is set.
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/preloop" <<'SH'
#!/usr/bin/env bash
args=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = --payload ]; then cp "$2" "$FAKE_LOG.payload"; shift 2; continue; fi
  args+=("$1")
  shift
done
set -- ${args[@]+"${args[@]}"}
echo "$*" >> "$FAKE_LOG"
if [ "$1" = doctor ] && [ -n "${FAKE_DOCTOR_FAIL:-}" ]; then exit 1; fi
if [ "$1" = run ] && [ -n "${FAKE_FAIL:-}" ] && [[ "$*" == *"$FAKE_FAIL"* ]]; then exit 1; fi
exit 0
SH
chmod +x "$FAKE_BIN/preloop"

create_repo() {
  local repo="$1"
  mkdir -p "$repo/.github/workflows"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name test
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" remote add origin https://github.com/acme/widgets.git

  cat > "$repo/.github/workflows/block.yml" <<'YAML'
name: Block form
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs: {}
YAML
  cat > "$repo/.github/workflows/inline.yml" <<'YAML'
on: [push, pull_request] # both
jobs: {}
YAML
  cat > "$repo/.github/workflows/list.yaml" <<'YAML'
"on":
  - push
  - pull_request
jobs: {}
YAML
  cat > "$repo/.github/workflows/deploy.yml" <<'YAML'
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      pull_request:
        description: a nested key, not a trigger
jobs: {}
YAML
  cat > "$repo/.github/workflows/target.yml" <<'YAML'
on:
  pull_request_target:
jobs:
  x:
    # pull_request: in a comment
    steps: []
YAML
  git -C "$repo" add -A
  git -C "$repo" commit -q -m init
}

# run_ci_local <repo> <output-file> [args...]; returns ci-local.sh's exit code.
run_ci_local() {
  local repo="$1" output_file="$2"
  shift 2
  set +e
  (cd "$repo" && PATH="${TEST_PATH:-$FAKE_BIN:$BASE_PATH}" FAKE_LOG="$repo.log" \
    bash "$CI_LOCAL" "$@") > "$output_file" 2>&1
  local status=$?
  set -e
  return "$status"
}

stamp_of() {
  cat "$1/.git/preloop-pass" 2>/dev/null || true
}

test_runs_only_pull_request_workflows() {
  local repo="$TEST_TMP/discover"
  create_repo "$repo"

  run_ci_local "$repo" "$repo.out" || fail "expected pass, got: $(cat "$repo.out")"
  local runs
  runs="$(grep '^run ' "$repo.log")"
  [ "$runs" = "run -f .github/workflows/block.yml --event pull_request
run -f .github/workflows/inline.yml --event pull_request
run -f .github/workflows/list.yaml --event pull_request" ] ||
    fail "expected block, inline and list only, got: $runs"
}

test_passes_a_pull_request_payload_with_the_merge_base() {
  local repo="$TEST_TMP/payload"
  create_repo "$repo"
  local base
  base="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" update-ref refs/remotes/origin/main "$base"
  git -C "$repo" checkout -q -b feat/x
  git -C "$repo" commit -q --allow-empty -m change

  run_ci_local "$repo" "$repo.out" || fail "expected pass, got: $(cat "$repo.out")"
  local payload
  payload="$(tr -d ' \n' < "$repo.log.payload")"
  [[ "$payload" == *'"pull_request":{"number":0,'* ]] ||
    fail "expected PR number 0, got: $payload"
  [[ "$payload" == *"\"base\":{\"ref\":\"main\",\"sha\":\"$base\"}"* ]] ||
    fail "expected base main at $base, got: $payload"
  [[ "$payload" == *"\"head\":{\"ref\":\"feat/x\",\"sha\":\"$(git -C "$repo" rev-parse HEAD)\"}"* ]] ||
    fail "expected head feat/x at HEAD, got: $payload"
}

test_checks_github_auth_for_the_origin_repo() {
  local repo="$TEST_TMP/doctor"
  create_repo "$repo"

  run_ci_local "$repo" "$repo.out" || fail "expected pass, got: $(cat "$repo.out")"
  grep -qx "doctor --repo acme/widgets" "$repo.log" ||
    fail "expected preloop doctor --repo acme/widgets, got: $(cat "$repo.log")"
}

test_stamps_head_after_a_clean_full_pass() {
  local repo="$TEST_TMP/stamp"
  create_repo "$repo"

  run_ci_local "$repo" "$repo.out" || fail "expected pass, got: $(cat "$repo.out")"
  [ "$(stamp_of "$repo")" = "$(git -C "$repo" rev-parse HEAD)" ] ||
    fail "expected the stamp to hold HEAD, got: '$(stamp_of "$repo")'"
}

test_single_workflow_runs_only_that_one_and_does_not_stamp() {
  local repo="$TEST_TMP/single"
  create_repo "$repo"

  run_ci_local "$repo" "$repo.out" .github/workflows/block.yml ||
    fail "expected pass, got: $(cat "$repo.out")"
  [ "$(grep -c '^run ' "$repo.log")" = 1 ] || fail "expected one run, got: $(cat "$repo.log")"
  grep -q "run -f .github/workflows/block.yml" "$repo.log" || fail "expected block.yml to run"
  [ -z "$(stamp_of "$repo")" ] || fail "a partial run must not write a stamp"
}

test_fails_when_a_workflow_fails_and_still_runs_the_rest() {
  local repo="$TEST_TMP/failing"
  create_repo "$repo"

  if FAKE_FAIL=block.yml run_ci_local "$repo" "$repo.out"; then
    fail "expected a non-zero exit when a workflow fails"
  fi
  [ "$(grep -c '^run ' "$repo.log")" = 3 ] || fail "expected all 3 workflows to run"
  grep -q "FAIL  .github/workflows/block.yml" "$repo.out" ||
    fail "expected the summary to name block.yml, got: $(cat "$repo.out")"
  [ -z "$(stamp_of "$repo")" ] || fail "a failing run must not write a stamp"
}

test_failing_full_run_removes_an_old_stamp() {
  local repo="$TEST_TMP/stale"
  create_repo "$repo"
  git -C "$repo" rev-parse HEAD > "$repo/.git/preloop-pass"

  if FAKE_FAIL=inline.yml run_ci_local "$repo" "$repo.out"; then
    fail "expected a non-zero exit"
  fi
  [ -z "$(stamp_of "$repo")" ] || fail "expected the old stamp to be removed"
}

test_does_not_stamp_a_dirty_tree() {
  local repo="$TEST_TMP/dirty"
  create_repo "$repo"
  echo "wip" > "$repo/untracked.txt"

  run_ci_local "$repo" "$repo.out" || fail "expected pass, got: $(cat "$repo.out")"
  [ -z "$(stamp_of "$repo")" ] || fail "a dirty tree must not be stamped"
  grep -q "uncommitted changes" "$repo.out" ||
    fail "expected a note about uncommitted changes, got: $(cat "$repo.out")"
}

test_blocks_with_setup_steps_when_preloop_is_missing() {
  local repo="$TEST_TMP/missing"
  create_repo "$repo"

  if TEST_PATH="$BASE_PATH" run_ci_local "$repo" "$repo.out"; then
    fail "expected a non-zero exit without preloop"
  fi
  grep -q "mise install" "$repo.out" || fail "expected setup steps, got: $(cat "$repo.out")"
  grep -q "preloop setup github --via pat --repo acme/widgets" "$repo.out" ||
    fail "expected the PAT setup command, got: $(cat "$repo.out")"
  grep -q "80GB" "$repo.out" || fail "expected the disk note, got: $(cat "$repo.out")"
}

test_blocks_with_setup_steps_when_auth_is_missing() {
  local repo="$TEST_TMP/no-auth"
  create_repo "$repo"

  if FAKE_DOCTOR_FAIL=1 run_ci_local "$repo" "$repo.out"; then
    fail "expected a non-zero exit when preloop doctor fails"
  fi
  grep -q "preloop setup github" "$repo.out" || fail "expected setup steps, got: $(cat "$repo.out")"
  if grep -q '^run ' "$repo.log"; then fail "no workflow should run without auth"; fi
}

test_runs_only_pull_request_workflows
test_passes_a_pull_request_payload_with_the_merge_base
test_checks_github_auth_for_the_origin_repo
test_stamps_head_after_a_clean_full_pass
test_single_workflow_runs_only_that_one_and_does_not_stamp
test_fails_when_a_workflow_fails_and_still_runs_the_rest
test_failing_full_run_removes_an_old_stamp
test_does_not_stamp_a_dirty_tree
test_blocks_with_setup_steps_when_preloop_is_missing
test_blocks_with_setup_steps_when_auth_is_missing

echo "ci-local tests passed"
