#!/usr/bin/env bash

# Runs this repo's GitHub Actions workflows locally with Preloop
# (https://github.com/preloopdev/preloop), against the working tree.
#
#   pnpm ci:local                                    every pull_request workflow
#   pnpm ci:local .github/workflows/typecheck.yml    just that one
#
# Exits non-zero if any workflow fails. When every pull_request workflow
# passes on a clean working tree, it writes a pass stamp (the current commit
# SHA) to .git/preloop-pass. The Claude Code push gate (packages/claude-hooks)
# only lets an agent `git push` or `gh pr create` when that stamp matches HEAD.
#
# Written for bash 3.2 too (the default /bin/bash on macOS): no `mapfile`, and
# arrays that may be empty expand as ${ARR[@]+"${ARR[@]}"} so `set -u` is happy.

set -uo pipefail

STAMP_NAME="preloop-pass"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ci:local: run this from inside the repo." >&2
  exit 1
}
cd "$ROOT" || exit 1

# owner/repo from the origin remote, for `preloop setup` / `preloop doctor`.
repo_slug() {
  git remote get-url origin 2>/dev/null |
    sed -nE 's#^.*github\.com[:/]([^/]+/[^/]+)$#\1#p' | sed 's/\.git$//'
}
SLUG="$(repo_slug)"

setup_steps() {
  cat >&2 <<MSG

Preloop setup (needed by anyone who uses an AI agent in this repo):
  1. Install the pinned tools, Preloop included:  mise install
  2. Connect Preloop to GitHub with a fine-grained PAT:
       preloop setup github --via pat --repo ${SLUG:-<owner>/<repo>}
  3. Start the engine and leave it running in another terminal:  pnpm ci:serve
  4. Keep about 80GB of disk free. The first run downloads and unpacks the
     GitHub runner VM image.
See "Local CI with Preloop" in the Readme.
MSG
}

# Succeeds if the workflow file has a pull_request trigger in its `on:` key:
# `on: pull_request`, `on: [push, pull_request]`, or a `pull_request:` (or
# `- pull_request`) entry in an `on:` block. pull_request_target doesn't count.
is_pr_workflow() {
  awk -v q="'" '
    function has_pr(s) { return s ~ /(^|[^A-Za-z0-9_-])pull_request([^A-Za-z0-9_-]|$)/ }
    {
      line = $0
      if (line ~ /^[ \t]*#/) next
      sub(/[ \t]+#.*$/, "", line)
    }
    line ~ /^("on"|on):/ || line ~ ("^" q "on" q ":") {
      value = line
      sub(/^[^:]*:[ \t]*/, "", value)
      if (value != "") { if (has_pr(value)) found = 1; in_on = 0 } else { in_on = 1; child = -1 }
      next
    }
    in_on && line ~ /^[^ \t]/ { in_on = 0 }
    in_on && line ~ /[^ \t]/ {
      match(line, /^[ \t]*/)
      if (child < 0) child = RLENGTH
      if (RLENGTH == child) {
        key = line
        sub(/^[ \t]*(-[ \t]+)?/, "", key)
        sub(/[ \t]*:.*$/, "", key)
        gsub(/"/, "", key)
        gsub(q, "", key)
        if (key == "pull_request") found = 1
      }
    }
    END { exit found ? 0 : 1 }
  ' "$1"
}

pr_workflows() {
  local file
  for file in .github/workflows/*.yml .github/workflows/*.yaml; do
    [ -f "$file" ] && is_pr_workflow "$file" && echo "$file"
  done
}

# Escapes a string for a JSON string literal.
json_string() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# Writes the pull_request event payload every run gets. Without one the engine
# has no base SHA to diff against. Number 0 means "no real PR"; the workflows
# key their local-only behavior on github.repository_id == 0 instead.
write_payload() {
  local base_ref head_ref head_sha base_sha
  base_ref="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
  base_ref="${base_ref#origin/}"
  base_ref="${base_ref:-main}"
  head_ref="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo HEAD)"
  head_sha="$(git rev-parse HEAD)"
  base_sha="$(git merge-base HEAD "origin/$base_ref" 2>/dev/null || echo "$head_sha")"
  cat > "$1" <<JSON
{
  "action": "synchronize",
  "number": 0,
  "pull_request": {
    "number": 0,
    "base": { "ref": $(json_string "$base_ref"), "sha": "$base_sha" },
    "head": { "ref": $(json_string "$head_ref"), "sha": "$head_sha" }
  }
}
JSON
}

# The tree is clean when there is nothing to commit, untracked files included:
# Preloop runs the working tree, untracked files and all, so they'd count.
tree_is_clean() {
  [ -z "$(git status --porcelain 2>/dev/null)" ]
}

if ! command -v preloop >/dev/null 2>&1; then
  echo "ci:local: Preloop isn't installed (no \`preloop\` on PATH)." >&2
  setup_steps
  exit 1
fi

if [ -n "$SLUG" ] && ! preloop doctor --repo "$SLUG" >&2; then
  echo "ci:local: Preloop's GitHub auth isn't set up for $SLUG." >&2
  setup_steps
  exit 1
fi

STAMP_FILE="$(git rev-parse --git-path "$STAMP_NAME")"
FULL_RUN=0
if [ "$#" -eq 0 ]; then
  FULL_RUN=1
  # A new full run replaces any earlier result, even for the same commit.
  rm -f "$STAMP_FILE"
  WORKFLOWS=()
  while IFS= read -r workflow; do WORKFLOWS+=("$workflow"); done < <(pr_workflows)
  if [ "${#WORKFLOWS[@]}" -eq 0 ]; then
    echo "ci:local: no pull_request workflows found in .github/workflows." >&2
    exit 1
  fi
else
  WORKFLOWS=("$@")
fi

START_HEAD="$(git rev-parse HEAD 2>/dev/null)"
START_CLEAN=0
tree_is_clean && START_CLEAN=1

# Outside the repo, so the payload never makes the tree dirty.
PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT
write_payload "$PAYLOAD"

PASSED=()
FAILED=()
for workflow in "${WORKFLOWS[@]}"; do
  echo "==> ci:local: $workflow"
  if preloop run -f "$workflow" --event pull_request --payload "$PAYLOAD"; then
    PASSED+=("$workflow")
  else
    FAILED+=("$workflow")
  fi
done

echo
echo "ci:local summary:"
for workflow in ${PASSED[@]+"${PASSED[@]}"}; do echo "  pass  $workflow"; done
for workflow in ${FAILED[@]+"${FAILED[@]}"}; do echo "  FAIL  $workflow"; done

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "ci:local: ${#FAILED[@]} workflow(s) failed. Fix them and run pnpm ci:local again." >&2
  exit 1
fi

if [ "$FULL_RUN" -eq 0 ]; then
  echo "ci:local: passed. No pass stamp: only a full \`pnpm ci:local\` run writes one."
elif [ "$START_CLEAN" -eq 1 ] && tree_is_clean &&
  [ "$(git rev-parse HEAD 2>/dev/null)" = "$START_HEAD" ]; then
  echo "$START_HEAD" > "$STAMP_FILE"
  echo "ci:local: all workflows passed. Stamped $START_HEAD, so it can be pushed."
else
  echo "ci:local: all workflows passed, but the working tree had uncommitted changes (or HEAD moved)," \
    "so there is no pass stamp. Commit, then run pnpm ci:local again before pushing."
fi
