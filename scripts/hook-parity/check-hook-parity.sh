#!/usr/bin/env bash

# lefthook.yml follows one rule: if CI would fail, the commit (or push) fails
# first. This check keeps that rule true. It lists the checks the git hooks
# run and the checks the pull_request workflows run, and fails if one side
# runs a check the other doesn't.
#
# A "check" is a pnpm script or a script under scripts/. A pnpm script that
# is a `turbo run` counts as its turbo tasks, so the hook's `pnpm verify`
# (lint, typecheck, typecheck:root, test) matches CI's separate `pnpm lint`,
# `pnpm typecheck` and `pnpm test` steps. A step whose whole command is the
# body of a package.json script counts as that script, so CI's
# `node --test .github/actions/sbom-*/*.test.mjs` matches the hook's
# `pnpm test:sbom`.
#
# The check fails closed: every `run:` step and every local composite action
# (`uses: ./...`) must map to a check, or be listed in CI_ONLY_STEPS with a
# reason. Third-party actions (`uses: owner/repo@sha`) are skipped.
#
# Usage: check-hook-parity.sh [repo-root]  (defaults to this repo)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-${SCRIPT_DIR}/../..}"

# Checks only CI runs, and why the hooks skip them.
CI_ONLY=(
  test-report # merges the coverage `test` already produced; can't fail on its own
)

# CI steps that run no check the hooks could mirror, as "<step>|<reason>".
# A step is "<workflow file>: <step name>", or the path of a local action.
CI_ONLY_STEPS=(
  "./.github/actions/setup|installs the toolchain and dependencies; runs no check"
  "./.github/actions/sbom-lockfile|builds the SBOM artifact from pnpm-lock.yaml; runs no check"
  "./.github/actions/sbom-scan|matches the SBOM against an advisory feed that changes without a commit; needs network and isn't a required check (see SBOM.md)"
  "code-coverage.yml: Generate and read coverage summary|reads the coverage report \`test\` already produced"
  "lint.yml: Test ci:local under bash 3.2|runs the ci:local tests under macOS's bash 3.2 in Docker, which the hooks can't assume is installed"
)

# Prints the body of a package.json script, or nothing if it doesn't exist.
script_body() {
  node -e 'const s = require(process.argv[1]).scripts ?? {}; if (s[process.argv[2]]) console.log(s[process.argv[2]])' \
    "$ROOT/package.json" "$1"
}

# Prints the name of the package.json script whose body is exactly $1.
script_named_by_body() {
  node -e 'const s = require(process.argv[1]).scripts ?? {}; const n = Object.keys(s).find((k) => s[k] === process.argv[2]); if (n) console.log(n)' \
    "$ROOT/package.json" "$1"
}

# Reads a workflow or lefthook.yml on stdin and prints one line per step:
# "<step name>\t<command>". Block scalars (`run: |`) are joined with " ; ".
# Local actions print "<path>\tuses: <path>".
steps_in() {
  awk '
    function emit(cmd) { printf "%s\t%s\n", (name != "" ? name : cmd), cmd }
    block {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (line == "" || length($0) - length(line) > block_col) {
        if (line != "" && line !~ /^#/) cmd = cmd (cmd == "" ? "" : " ; ") line
        next
      }
      emit(cmd)
      block = 0
    }
    {
      key = $0
      sub(/^[[:space:]]+/, "", key)
      if (key ~ /^#/) next
      # A list item that starts with a key ("- name:", "- run:") is a new
      # step. Plain items ("- main", "- \"e2e/**\"") belong to the last one.
      if (key ~ /^- +[A-Za-z_-]+:/) name = ""
      sub(/^- +/, "", key)
      col = length($0) - length(key)
      if (key ~ /^name:/) {
        name = key
        sub(/^name:[[:space:]]*/, "", name)
        gsub(/^["\047]|["\047]$/, "", name)
      } else if (key ~ /^run:[[:space:]]*[|>][-+]?[[:space:]]*$/) {
        block = 1
        block_col = col
        cmd = ""
      } else if (key ~ /^run:/) {
        sub(/^run:[[:space:]]*/, "", key)
        emit(key)
      } else if (key ~ /^uses:[[:space:]]*\.\//) {
        sub(/^uses:[[:space:]]*/, "", key)
        sub(/[[:space:]]+#.*$/, "", key)
        printf "%s\tuses: %s\n", key, key
      }
    }
    END { if (block) emit(cmd) }
  '
}

# Prints the checks one step command runs, one per line.
checks_in() {
  grep -oE 'pnpm (exec )?[A-Za-z][A-Za-z0-9:_-]*|\./scripts/[A-Za-z0-9/_.-]+' <<< "$1" |
    while read -r cmd; do
      case "$cmd" in
        "pnpm install") ;;
        # The hook formats staged files with `prettier --write`; CI runs the
        # same Prettier config as `pnpm format:check`.
        "pnpm exec prettier") echo "format:check" ;;
        pnpm\ exec\ *) echo "${cmd#pnpm exec }" ;;
        ./scripts/*) echo "${cmd#./}" ;;
        pnpm\ *)
          local name="${cmd#pnpm }" body
          body="$(script_body "$name")"
          if [[ "$body" == "turbo run "* ]]; then
            for word in ${body#turbo run }; do
              [[ "$word" == -* ]] || echo "$word"
            done
          else
            echo "$name"
          fi
          ;;
      esac
    done || true
}

ci_only_step() {
  local entry
  for entry in "${CI_ONLY_STEPS[@]}"; do
    [[ "${entry%%|*}" == "$1" ]] && return 0
  done
  return 1
}

ERRORS=0
UNMAPPED="$(mktemp)"
trap 'rm -f "$UNMAPPED"' EXIT

# Prints the checks a file's steps run. A step it can't map goes to
# $UNMAPPED, unless CI_ONLY_STEPS lists it.
checks_in_file() {
  local file="$1" label name cmd checks
  label="$(basename "$file")"
  while IFS=$'\t' read -r name cmd; do
    if [[ "$cmd" == "uses: "* ]]; then
      ci_only_step "$name" || echo "$name (local action)|$cmd" >> "$UNMAPPED"
      continue
    fi
    [[ "$cmd" =~ ^pnpm\ install([[:space:]]|$) ]] && continue
    checks="$(checks_in "$cmd")"
    [[ -n "$checks" ]] || checks="$(script_named_by_body "$cmd")"
    if [[ -n "$checks" ]]; then
      echo "$checks"
    elif ! ci_only_step "$label: $name"; then
      echo "$label: $name|$cmd" >> "$UNMAPPED"
    fi
  done < <(steps_in < "$file")
}

hook_checks="$(checks_in_file "$ROOT/lefthook.yml" | sort -u)"

ci_checks="$(
  for workflow in "$ROOT"/.github/workflows/*.yml; do
    if grep -q 'pull_request' "$workflow"; then
      checks_in_file "$workflow"
    fi
  done | sort -u
)"
ci_checks="$(comm -23 <(echo "$ci_checks") <(printf '%s\n' "${CI_ONLY[@]}" | sort -u))"

while IFS='|' read -r step cmd; do
  [[ -n "$step" ]] || continue
  echo "ERROR: $step runs \`$cmd\`, which matches no check. Run it through a pnpm script that lefthook.yml and CI both call, or add the step to CI_ONLY_STEPS in this script with a reason." >&2
  ERRORS=$((ERRORS + 1))
done < "$UNMAPPED"

while read -r check; do
  [[ -n "$check" ]] || continue
  echo "ERROR: CI runs '$check' but no git hook does. Add it to lefthook.yml, or to CI_ONLY in this script with a reason." >&2
  ERRORS=$((ERRORS + 1))
done < <(comm -23 <(echo "$ci_checks") <(echo "$hook_checks"))

while read -r check; do
  [[ -n "$check" ]] || continue
  echo "ERROR: a git hook runs '$check' but no pull_request workflow does. Add it to a workflow in .github/workflows." >&2
  ERRORS=$((ERRORS + 1))
done < <(comm -13 <(echo "$ci_checks") <(echo "$hook_checks"))

if [[ "$ERRORS" -gt 0 ]]; then
  echo "Hook/CI parity check failed with $ERRORS error(s)." >&2
  exit 1
fi

echo "Git hooks and CI run the same checks."
