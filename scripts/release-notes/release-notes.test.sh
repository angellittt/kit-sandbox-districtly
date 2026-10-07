#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_FILE="${SCRIPT_DIR}/../../.github/workflows/staging-release-notes.yml"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

create_repo() {
  local repo="$1"

  git init -q "$repo"
  git -C "$repo" config user.name "Release Notes Test"
  git -C "$repo" config user.email "release-notes-test@example.com"

  printf '%s\n' "first" > "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "first commit"

  printf '%s\n' "second" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "second commit"

  printf '%s\n' "third" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "third commit"
}

# A fake `gh` that only understands `gh api graphql -f query=...` (returns
# empty output, exit 0 — i.e. "no PR associated with anything") and rejects
# every other invocation. Good enough for tests that only care about boundary
# detection, not PR content.
make_fake_gh() {
  local bin_dir="$1"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/gh" <<'SCRIPT'
#!/usr/bin/env bash
if [ "${1:-}" = "api" ] && [ "${2:-}" = "graphql" ]; then
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 1
SCRIPT
  chmod +x "$bin_dir/gh"
}

make_fake_date() {
  local bin_dir="$1"

  cat > "$bin_dir/date" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "${FAKE_DATE:?FAKE_DATE is required}"
SCRIPT
  chmod +x "$bin_dir/date"
}

test_invalid_override_is_rejected() {
  local repo="$TEST_TMP/invalid-override"
  local bin_dir="$TEST_TMP/bin-invalid-override"
  local stderr_file="$TEST_TMP/invalid-override.stderr"

  create_repo "$repo"
  make_fake_gh "$bin_dir"

  if (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      PREV_MERGE_OVERRIDE="not-a-commit" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  ) > /dev/null 2> "$stderr_file"; then
    fail "collect-context.sh accepted an invalid PREV_MERGE_OVERRIDE"
  fi

  grep -q "PREV_MERGE_OVERRIDE 'not-a-commit' is not a valid ancestor commit" "$stderr_file" ||
    fail "invalid override did not produce the expected error"
}

test_override_equal_to_head_is_rejected() {
  local repo="$TEST_TMP/empty-range"
  local bin_dir="$TEST_TMP/bin-empty-range"
  local stderr_file="$TEST_TMP/empty-range.stderr"
  local head_sha=""

  create_repo "$repo"
  make_fake_gh "$bin_dir"
  head_sha="$(git -C "$repo" rev-parse HEAD)"

  if (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      PREV_MERGE_OVERRIDE="$head_sha" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  ) > /dev/null 2> "$stderr_file"; then
    fail "collect-context.sh accepted a boundary equal to HEAD"
  fi

  grep -q "does not contain any commits" "$stderr_file" ||
    fail "empty range did not produce the expected error"
}

test_missing_boundary_is_rejected() {
  local repo="$TEST_TMP/missing-boundary"
  local bin_dir="$TEST_TMP/bin-missing-boundary"
  local stderr_file="$TEST_TMP/missing-boundary.stderr"

  create_repo "$repo"
  make_fake_gh "$bin_dir"

  if (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  ) > /dev/null 2> "$stderr_file"; then
    fail "collect-context.sh accepted a run with no trustworthy deploy boundary"
  fi

  grep -q "No previous staging deploy boundary found" "$stderr_file" ||
    fail "missing boundary did not produce the expected error"
}

test_manual_run_uses_previous_release_notes_commit() {
  local repo="$TEST_TMP/release-notes-boundary"
  local bin_dir="$TEST_TMP/bin-release-notes-boundary"
  local output_file="$TEST_TMP/release-notes-boundary.outputs"
  local boundary=""
  local deploy_sha=""
  local context_file=""

  git init -q "$repo"
  git -C "$repo" config user.name "Release Notes Test"
  git -C "$repo" config user.email "release-notes-test@example.com"

  printf '%s\n' "base" > "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "base commit"

  printf '%s\n' "notes" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "docs(release-notes): qa notes for 2026-06-24 [skip ci]"
  boundary="$(git -C "$repo" rev-parse HEAD)"

  printf '%s\n' "deploy" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "deploy commit"
  deploy_sha="$(git -C "$repo" rev-parse HEAD)"
  make_fake_gh "$bin_dir"

  (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      RELEASE_CHANNEL="qa" \
      GITHUB_OUTPUT="$output_file" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  )

  grep -q "^range=${boundary}..${deploy_sha}$" "$output_file" ||
    fail "manual run did not use the previous release-notes commit as its boundary"

  context_file="$(sed -n 's/^context_file=//p' "$output_file")"
  grep -q '^# QA release context' "$context_file" ||
    fail "QA context did not use the QA heading"
  grep -q -- "- deploy commit" "$context_file" ||
    fail "manual run omitted commits after the previous release-notes commit"
}

test_manual_run_excludes_release_notes_tip() {
  local repo="$TEST_TMP/release-notes-tip"
  local bin_dir="$TEST_TMP/bin-release-notes-tip"
  local output_file="$TEST_TMP/release-notes-tip.outputs"
  local boundary=""
  local deploy_sha=""
  local context_file=""

  git init -q "$repo"
  git -C "$repo" config user.name "Release Notes Test"
  git -C "$repo" config user.email "release-notes-test@example.com"

  printf '%s\n' "base" > "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "base commit"

  printf '%s\n' "old notes" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "docs(release-notes): qa notes for 2026-06-23 [skip ci]"
  boundary="$(git -C "$repo" rev-parse HEAD)"

  printf '%s\n' "deploy" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "deploy commit"
  deploy_sha="$(git -C "$repo" rev-parse HEAD)"

  printf '%s\n' "new notes" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "docs(release-notes): qa notes for 2026-06-24 [skip ci]"
  make_fake_gh "$bin_dir"

  (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      RELEASE_CHANNEL="qa" \
      GITHUB_OUTPUT="$output_file" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  )

  grep -q "^range=${boundary}..${deploy_sha}$" "$output_file" ||
    fail "manual run did not stop before the release-notes tip commit"

  context_file="$(sed -n 's/^context_file=//p' "$output_file")"
  grep -q -- "- deploy commit" "$context_file" ||
    fail "manual run omitted the deploy commit"

  if grep -q "docs(release-notes)" "$context_file"; then
    fail "manual run included a release-notes bot commit"
  fi
}

test_zero_before_sha_uses_release_notes_fallback() {
  local repo="$TEST_TMP/zero-before-sha"
  local bin_dir="$TEST_TMP/bin-zero-before-sha"
  local output_file="$TEST_TMP/zero-before-sha.outputs"
  local boundary=""
  local deploy_sha=""

  git init -q "$repo"
  git -C "$repo" config user.name "Release Notes Test"
  git -C "$repo" config user.email "release-notes-test@example.com"

  printf '%s\n' "base" > "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "base commit"

  printf '%s\n' "notes" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "docs(release-notes): qa notes for 2026-06-24 [skip ci]"
  boundary="$(git -C "$repo" rev-parse HEAD)"

  printf '%s\n' "deploy" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "deploy commit"
  deploy_sha="$(git -C "$repo" rev-parse HEAD)"
  make_fake_gh "$bin_dir"

  (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      RELEASE_CHANNEL="qa" \
      BEFORE_SHA="0000000000000000000000000000000000000000" \
      GITHUB_OUTPUT="$output_file" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  )

  grep -q "^range=${boundary}..${deploy_sha}$" "$output_file" ||
    fail "all-zero BEFORE_SHA did not use the previous release-notes boundary"
}

# Fakes `gh api graphql` for both the commit-association and PR-detail
# queries: recognizes a request by which alias it asks for (c<idx> for the
# commit lookup, p<num> for the PR-detail lookup) and returns canned JSON.
make_fake_gh_with_pr() {
  local bin_dir="$1" pr_sha="$2" pr_number="$3" pr_title="$4"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/gh" <<SCRIPT
#!/usr/bin/env bash
if [ "\${1:-}" = "api" ] && [ "\${2:-}" = "graphql" ]; then
  query="\$*"
  case "\$query" in
    *"associatedPullRequests"*)
      if printf '%s' "\$query" | grep -qF '"${pr_sha}"'; then
        # Find which alias (c0, c1, ...) was assigned to our commit, and
        # answer only that one — every other aliased commit gets an empty
        # associatedPullRequests, i.e. "no PR found" (falls back to direct commit).
        alias_name="\$(printf '%s' "\$query" | grep -oE '[a-zA-Z0-9_]+: object\(oid: "${pr_sha}"\)' | cut -d: -f1)"
        printf '{"data":{"repository":{"%s":{"associatedPullRequests":{"nodes":[{"number":${pr_number}}]}}}}}\n' "\$alias_name"
      else
        printf '{"data":{"repository":{}}}\n'
      fi
      ;;
    *"pullRequest(number: ${pr_number})"*)
      printf '{"data":{"repository":{"p${pr_number}":{"number":${pr_number},"title":"${pr_title}","body":"Pull request change","author":{"login":"tester"},"labels":{"nodes":[]},"mergedAt":"2026-06-24T00:00:00Z"}}}}\n'
      ;;
    *)
      printf '{"data":{"repository":{}}}\n'
      ;;
  esac
  exit 0
fi

echo "unexpected gh invocation: \$*" >&2
exit 1
SCRIPT
  chmod +x "$bin_dir/gh"
}

test_pr_context_includes_direct_commits() {
  local repo="$TEST_TMP/direct-commits"
  local bin_dir="$TEST_TMP/bin-direct-commits"
  local output_file="$TEST_TMP/direct-commits.outputs"
  local boundary=""
  local pr_sha=""
  local context_file=""

  git init -q "$repo"
  git -C "$repo" config user.name "Release Notes Test"
  git -C "$repo" config user.email "release-notes-test@example.com"

  printf '%s\n' "base" > "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "base commit"
  boundary="$(git -C "$repo" rev-parse HEAD)"

  printf '%s\n' "pull request" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "pull request commit"
  pr_sha="$(git -C "$repo" rev-parse HEAD)"

  printf '%s\n' "direct" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "direct config fix"

  make_fake_gh_with_pr "$bin_dir" "$pr_sha" 42 "Pull request change"

  (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      BEFORE_SHA="$boundary" \
      GITHUB_OUTPUT="$output_file" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  )

  context_file="$(sed -n 's/^context_file=//p' "$output_file")"
  grep -q "### PR #42: Pull request change" "$context_file" ||
    fail "PR details were omitted from mixed context"
  grep -q -- "- Labels: none" "$context_file" ||
    fail "PR with no labels did not fall back to 'none'"
  grep -q "## Direct Commits" "$context_file" ||
    fail "mixed context did not include a direct-commits section"
  grep -q -- "- direct config fix" "$context_file" ||
    fail "direct commit was omitted when PRs were present"
}

test_pr_detail_lookup_is_batched_per_chunk() {
  local repo="$TEST_TMP/batched-lookup"
  local bin_dir="$TEST_TMP/bin-batched-lookup"
  local output_file="$TEST_TMP/batched-lookup.outputs"
  local call_log="$TEST_TMP/batched-lookup.calls"
  local boundary=""
  local context_file=""
  local i=""
  local sha=""

  git init -q "$repo"
  git -C "$repo" config user.name "Release Notes Test"
  git -C "$repo" config user.email "release-notes-test@example.com"

  printf '%s\n' "base" > "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "base commit"
  boundary="$(git -C "$repo" rev-parse HEAD)"

  # 6 commits, each its own PR — with COMMIT_CHUNK_SIZE=3 this must resolve
  # in 2 GraphQL calls for association, not 6 individual calls.
  for i in 1 2 3 4 5 6; do
    printf '%s\n' "change ${i}" >> "$repo/history.txt"
    git -C "$repo" commit -q -am "change ${i}"
  done

  mkdir -p "$bin_dir"
  cat > "$bin_dir/gh" <<SCRIPT
#!/usr/bin/env bash
if [ "\${1:-}" = "api" ] && [ "\${2:-}" = "graphql" ]; then
  echo "call" >> "${call_log}"
  query="\$*"
  case "\$query" in
    *"associatedPullRequests"*)
      # No PR association in this test — every commit becomes a direct commit.
      printf '{"data":{"repository":{}}}\n'
      ;;
    *)
      printf '{"data":{"repository":{}}}\n'
      ;;
  esac
  exit 0
fi

echo "unexpected gh invocation: \$*" >&2
exit 1
SCRIPT
  chmod +x "$bin_dir/gh"

  (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      COMMIT_CHUNK_SIZE=3 \
      BEFORE_SHA="$boundary" \
      GITHUB_OUTPUT="$output_file" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  )

  [ "$(wc -l < "$call_log" | tr -d ' ')" = "2" ] ||
    fail "expected exactly 2 batched GraphQL calls for 6 commits at chunk size 3, got $(wc -l < "$call_log")"

  context_file="$(sed -n 's/^context_file=//p' "$output_file")"
  grep -q -- "- change 6" "$context_file" ||
    fail "batched lookup lost a commit"
}

test_context_size_cap_degrades_gracefully() {
  local repo="$TEST_TMP/size-cap"
  local bin_dir="$TEST_TMP/bin-size-cap"
  local output_file="$TEST_TMP/size-cap.outputs"
  local boundary=""
  local context_file=""
  local big_body=""

  git init -q "$repo"
  git -C "$repo" config user.name "Release Notes Test"
  git -C "$repo" config user.email "release-notes-test@example.com"

  printf '%s\n' "base" > "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "base commit"
  boundary="$(git -C "$repo" rev-parse HEAD)"

  printf '%s\n' "pr one" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "pr one commit"
  local sha_one
  sha_one="$(git -C "$repo" rev-parse HEAD)"

  printf '%s\n' "pr two" >> "$repo/history.txt"
  git -C "$repo" commit -q -am "pr two commit"
  local sha_two
  sha_two="$(git -C "$repo" rev-parse HEAD)"

  big_body="$(printf 'x%.0s' $(seq 1 5000))"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/gh" <<SCRIPT
#!/usr/bin/env bash
if [ "\${1:-}" = "api" ] && [ "\${2:-}" = "graphql" ]; then
  query="\$*"
  case "\$query" in
    *"associatedPullRequests"*)
      if printf '%s' "\$query" | grep -qF '"${sha_one}"'; then
        alias_one="\$(printf '%s' "\$query" | grep -oE '[a-zA-Z0-9_]+: object\(oid: "${sha_one}"\)' | cut -d: -f1)"
        alias_two="\$(printf '%s' "\$query" | grep -oE '[a-zA-Z0-9_]+: object\(oid: "${sha_two}"\)' | cut -d: -f1)"
        printf '{"data":{"repository":{"%s":{"associatedPullRequests":{"nodes":[{"number":1}]}},"%s":{"associatedPullRequests":{"nodes":[{"number":2}]}}}}}\n' "\$alias_one" "\$alias_two"
      else
        printf '{"data":{"repository":{}}}\n'
      fi
      ;;
    *"pullRequest(number: 1)"*)
      printf '{"data":{"repository":{"p1":{"number":1,"title":"First PR","body":"${big_body}","author":{"login":"tester"},"labels":{"nodes":[]},"mergedAt":"2026-06-24T00:00:00Z"}}}}\n'
      ;;
    *"pullRequest(number: 2)"*)
      printf '{"data":{"repository":{"p2":{"number":2,"title":"Second PR","body":"${big_body}","author":{"login":"tester"},"labels":{"nodes":[]},"mergedAt":"2026-06-24T00:00:00Z"}}}}\n'
      ;;
    *)
      printf '{"data":{"repository":{}}}\n'
      ;;
  esac
  exit 0
fi

echo "unexpected gh invocation: \$*" >&2
exit 1
SCRIPT
  chmod +x "$bin_dir/gh"

  (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      PR_CHUNK_SIZE=1 \
      PR_BODY_MAX_CHARS=4000 \
      CONTEXT_MAX_BYTES=1500 \
      BEFORE_SHA="$boundary" \
      GITHUB_OUTPUT="$output_file" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  )

  context_file="$(sed -n 's/^context_file=//p' "$output_file")"
  grep -q "### PR #1: First PR" "$context_file" ||
    fail "size cap dropped the first PR entirely instead of always including it"
  if grep -q "### PR #2: Second PR" "$context_file"; then
    fail "size cap did not omit the second PR once the cap was reached"
  fi
  grep -q "context size cap reached" "$context_file" ||
    fail "size cap omission was not noted in the context file"
  grep -q "more characters omitted" "$context_file" ||
    fail "oversized PR body was not truncated"
}

test_context_hash_is_stable_across_dates() {
  local repo="$TEST_TMP/stable-hash"
  local bin_dir="$TEST_TMP/bin-stable-hash"
  local first_output="$TEST_TMP/stable-hash-first.outputs"
  local second_output="$TEST_TMP/stable-hash-second.outputs"
  local boundary=""
  local first_hash=""
  local second_hash=""

  create_repo "$repo"
  make_fake_gh "$bin_dir"
  make_fake_date "$bin_dir"
  boundary="$(git -C "$repo" rev-parse HEAD^)"

  (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      BEFORE_SHA="$boundary" \
      FAKE_DATE="2026-06-24" \
      GITHUB_OUTPUT="$first_output" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  )

  (
    cd "$repo"
    PATH="$bin_dir:$PATH" \
      BEFORE_SHA="$boundary" \
      FAKE_DATE="2026-06-25" \
      GITHUB_OUTPUT="$second_output" \
      RUNNER_TEMP="$TEST_TMP" \
      bash "$SCRIPT_DIR/collect-context.sh"
  )

  first_hash="$(sed -n 's/^context_hash=//p' "$first_output")"
  second_hash="$(sed -n 's/^context_hash=//p' "$second_output")"

  [ "$first_hash" = "$second_hash" ] ||
    fail "context hash changed when only the release date changed"
}

test_invalid_max_tokens_is_rejected() {
  local system_file="$TEST_TMP/system.txt"
  local context_file="$TEST_TMP/context.txt"
  local output_file="$TEST_TMP/generated.md"
  local stderr_file="$TEST_TMP/invalid-max-tokens.stderr"

  printf '%s\n' "system prompt" > "$system_file"
  printf '%s\n' "release context" > "$context_file"

  if ANTHROPIC_API_KEY="test-key" MAX_TOKENS="3000 " \
    bash "$SCRIPT_DIR/anthropic-generate.sh" \
      "$system_file" \
      "$context_file" \
      "$output_file" > /dev/null 2> "$stderr_file"; then
    fail "anthropic-generate.sh accepted an invalid MAX_TOKENS value"
  fi

  grep -q "MAX_TOKENS must be a positive integer, got: '3000 '" "$stderr_file" ||
    fail "invalid MAX_TOKENS did not produce the expected error"
}

test_update_index_writes_to_the_release_channel() {
  local repo="$TEST_TMP/update-index"
  local index_file="$repo/release-notes/qa/INDEX.md"
  local first_entry=""
  local second_entry=""

  git init -q "$repo"

  (
    cd "$repo"
    RELEASE_CHANNEL="qa" bash "$SCRIPT_DIR/update-index.sh" "2026-06-24"
    RELEASE_CHANNEL="qa" bash "$SCRIPT_DIR/update-index.sh" "2026-06-25"
  ) > /dev/null

  grep -q '^# QA Release Notes Index$' "$index_file" ||
    fail "QA index did not use the QA heading"

  first_entry="$(sed -n '5p' "$index_file")"
  second_entry="$(sed -n '6p' "$index_file")"

  [ "$first_entry" = "| 2026-06-25 | [QA notes](2026-06-25/qa.md) | [Client notes](2026-06-25/client.md) |" ] ||
    fail "newest release was not inserted first"
  [ "$second_entry" = "| 2026-06-24 | [QA notes](2026-06-24/qa.md) | [Client notes](2026-06-24/client.md) |" ] ||
    fail "existing release moved to the wrong position"

  (
    cd "$repo"
    bash "$SCRIPT_DIR/update-index.sh" "2026-06-25"
  ) > /dev/null

  grep -q '^# Staging Release Notes Index$' "$repo/release-notes/staging/INDEX.md" ||
    fail "staging index behavior was not preserved"
}

test_workflow_targets_qa_and_staging() {
  grep -q '^    branches: \[qa, staging\]$' "$WORKFLOW_FILE" ||
    fail "workflow does not trigger for both QA and staging"

  grep -Fq "  RELEASE_CHANNEL: \${{ github.ref_name }}" "$WORKFLOW_FILE" ||
    fail "workflow does not derive its release channel from the triggering branch"

  grep -Fq "  group: release-notes-\${{ github.ref_name }}" "$WORKFLOW_FILE" ||
    fail "workflow concurrency is not isolated per release channel"

  sed -n '/- name: Checkout repository/,/- name: Validate release channel/p' "$WORKFLOW_FILE" |
    grep -Fq "          ref: \${{ github.sha }}" ||
    fail "workflow does not checkout the selected branch commit"

  grep -q '^        run: bash scripts/release-notes/collect-context.sh$' "$WORKFLOW_FILE" ||
    fail "collect-context.sh output is still redirected into GITHUB_OUTPUT"

  if grep -Eq 'release-notes/staging|origin/staging|HEAD:staging' "$WORKFLOW_FILE"; then
    fail "workflow still contains a staging-only path or push target"
  fi
}

test_workflow_verifies_secret_through_environment() {
  local verify_block="$TEST_TMP/verify-secret.step"

  sed -n '/- name: Verify ANTHROPIC_API_KEY/,/- name: Collect context/p' "$WORKFLOW_FILE" > "$verify_block"

  grep -Fq "          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}" "$verify_block" ||
    fail "ANTHROPIC_API_KEY is not bound through the step environment"

  grep -Fq "if [ -z \"\$ANTHROPIC_API_KEY\" ]; then" "$verify_block" ||
    fail "secret verification does not read ANTHROPIC_API_KEY from the environment"
}

test_workflow_checks_remote_hashes_across_dates() {
  local guard_block="$TEST_TMP/idempotency.step"

  sed -n '/- name: Check idempotency/,/- name: Build system prompts/p' "$WORKFLOW_FILE" > "$guard_block"

  grep -Fq "git fetch origin \"+refs/heads/\${RELEASE_CHANNEL}:refs/remotes/origin/\${RELEASE_CHANNEL}\"" "$guard_block" ||
    fail "idempotency guard does not fetch the latest release branch"
  grep -Fq "git ls-tree -r --name-only \"origin/\${RELEASE_CHANNEL}\"" "$guard_block" ||
    fail "idempotency guard does not inspect remote hash files"
  grep -Fq "git show \"origin/\${RELEASE_CHANNEL}:\${hash_file}\"" "$guard_block" ||
    fail "idempotency guard does not read remote hash contents"
}

test_workflow_recovers_rebases_and_skips_empty_notifications() {
  local commit_block="$TEST_TMP/commit-notes.step"
  local slack_block="$TEST_TMP/slack.step"

  sed -n '/- name: Commit notes back/,/- name: Post to Slack/p' "$WORKFLOW_FILE" > "$commit_block"
  sed -n '/- name: Post to Slack/,$p' "$WORKFLOW_FILE" > "$slack_block"

  grep -q 'git rebase --abort 2>/dev/null || true' "$commit_block" ||
    fail "push retry does not clear an in-progress rebase"
  grep -Fq "git rebase -X theirs \"origin/\${RELEASE_CHANNEL}\"" "$commit_block" ||
    fail "push retry does not preserve the generated notes during conflict resolution"

  grep -Fq "git push origin \"HEAD:\${RELEASE_CHANNEL}\"" "$commit_block" ||
    fail "workflow does not push generated notes back to the triggering branch"

  grep -q 'id: publish' "$commit_block" ||
    fail "commit step does not expose publish state"
  grep -Fq "echo \"published=false\" >> \"\$GITHUB_OUTPUT\"" "$commit_block" ||
    fail "commit step does not report a no-op publish"
  grep -Fq "echo \"published=true\" >> \"\$GITHUB_OUTPUT\"" "$commit_block" ||
    fail "commit step does not report a successful publish"

  grep -Fq "if: steps.publish.outputs.published == 'true'" "$slack_block" ||
    fail "Slack notification is not gated on a successful publish"

  grep -Fq "release-notes/\${RELEASE_CHANNEL}/\${DATE_SLUG}" "$slack_block" ||
    fail "Slack links do not target the triggering branch folder"

  grep -q 'has_release_content()' "$slack_block" ||
    fail "Slack step does not validate generated note content"
  grep -q 'skipping Slack notification' "$slack_block" ||
    fail "Slack step does not skip empty or heading-only notes"

  grep -q 'SLACK_WEBHOOK_URL secret is not set' "$slack_block" ||
    fail "Slack step does not degrade gracefully when the webhook secret is unset"
}

test_invalid_override_is_rejected
test_override_equal_to_head_is_rejected
test_missing_boundary_is_rejected
test_manual_run_uses_previous_release_notes_commit
test_manual_run_excludes_release_notes_tip
test_zero_before_sha_uses_release_notes_fallback
test_pr_context_includes_direct_commits
test_pr_detail_lookup_is_batched_per_chunk
test_context_size_cap_degrades_gracefully
test_context_hash_is_stable_across_dates
test_invalid_max_tokens_is_rejected
test_update_index_writes_to_the_release_channel
test_workflow_targets_qa_and_staging
test_workflow_verifies_secret_through_environment
test_workflow_checks_remote_hashes_across_dates
test_workflow_recovers_rebases_and_skips_empty_notifications

echo "PASS: release-notes shell tests"
