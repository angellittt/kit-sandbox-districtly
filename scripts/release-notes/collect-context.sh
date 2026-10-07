#!/usr/bin/env bash
#
# collect-context.sh — gather raw context for the release-notes pipeline.
#
# WHAT IT DOES
#   1. Detects the previous deploy boundary for RELEASE_CHANNEL. Resolution order:
#        a. PREV_MERGE_OVERRIDE — explicit override (manual dispatch / local).
#        b. BEFORE_SHA          — the branch tip before this push
#                                 (github.event.before): the exact last deploy.
#        c. The latest generated release-notes commit before HEAD — a stable
#           fallback for manual runs.
#      Fails when no trustworthy boundary exists instead of silently omitting
#      commits or walking the entire repository history.
#   2. Builds a git range covering all commits since that boundary.
#   3. Enumerates Pull Requests merged in that range via GitHub's GraphQL API,
#      batching many commits into a single request instead of one request per
#      commit (see BATCHING below).
#   4. Falls back to raw git log when no PRs can be enumerated.
#   5. Writes a context document to a temp file for the AI generation step,
#      capping its size so a large release can't blow past the model's input
#      limit (see SIZE CAP below).
#
# BATCHING
#   Both GitHub lookups (commit -> associated PR, PR -> detail) are one-call-
#   per-item in the naive implementation, which is slow and can hit GitHub's
#   rate limit on a large release. Instead this script batches up to
#   COMMIT_CHUNK_SIZE / PR_CHUNK_SIZE items into a single GraphQL query per
#   batch, using aliased fields (c0, c1, ... / p<number>) so one HTTP request
#   resolves many items at once.
#
# SIZE CAP
#   Each PR body is truncated to PR_BODY_MAX_CHARS characters. Once the
#   accumulated PR-details section reaches CONTEXT_MAX_BYTES, remaining PRs are
#   omitted (with a note pointing at `git log` for the full list) instead of
#   silently truncating mid-PR or overflowing the model's input size limit.
#
# OUTPUTS (written to $GITHUB_OUTPUT if set, otherwise stdout):
#   context_file=<path>
#   context_hash=<sha256 of context excluding date-bearing lines>
#   date_slug=<YYYY-MM-DD>
#   range=<git range>
#
# LOCAL USAGE
#   bash scripts/release-notes/collect-context.sh
#
# Requires: git, gh (authenticated), jq. In GitHub Actions `gh` is
# pre-installed and authenticated via the GITHUB_TOKEN env var. The GraphQL
# calls use gh's own `{owner}`/`{repo}` placeholder substitution (resolved
# from the current directory's git remote, or $GH_REPO if set) — the same
# mechanism the original REST endpoint (repos/{owner}/{repo}/...) relied on —
# so no separate repository-resolution step is needed either in Actions or
# locally.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

RELEASE_CHANNEL="${RELEASE_CHANNEL:-staging}"
case "$RELEASE_CHANNEL" in
  qa)
    RELEASE_LABEL="QA"
    ;;
  staging)
    RELEASE_LABEL="Staging"
    ;;
  *)
    echo "::error::RELEASE_CHANNEL must be 'qa' or 'staging', got: '${RELEASE_CHANNEL}'" >&2
    exit 1
    ;;
esac

# Batching / size-cap tuning. Overridable via env for testing.
COMMIT_CHUNK_SIZE="${COMMIT_CHUNK_SIZE:-25}"
PR_CHUNK_SIZE="${PR_CHUNK_SIZE:-25}"
PR_BODY_MAX_CHARS="${PR_BODY_MAX_CHARS:-4000}"
CONTEXT_MAX_BYTES="${CONTEXT_MAX_BYTES:-200000}"

# --- Helper: emit key=value to $GITHUB_OUTPUT or stdout ----------------------
emit_output() {
  local key="$1" val="$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$key" "$val" >> "$GITHUB_OUTPUT"
  else
    printf '%s=%s\n' "$key" "$val"
  fi
}


# --- 1. Detect the previous deploy boundary ----------------------------------
# True when $1 resolves to a real commit object that is an ancestor of HEAD.
# Rejects the all-zero SHA git reports for "no previous commit" (e.g. on branch
# creation) and SHAs that are not reachable from HEAD (e.g. after a force-push).
_is_valid_ancestor() {
  local ref="$1"
  [ -n "$ref" ] || return 1
  case "$ref" in *[!0]*) ;; *) return 1 ;; esac
  git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1 || return 1
  git merge-base --is-ancestor "$ref" HEAD 2>/dev/null
}

_is_release_notes_commit() {
  local ref="$1"
  git log -1 --format='%s' "$ref" |
    grep -Eq "^docs\\(release-notes\\): ${RELEASE_CHANNEL} notes for .* \\[skip ci\\]$"
}

_find_previous_release_notes_commit() {
  local start_ref="$1"
  local release_sha=""

  while IFS= read -r release_sha; do
    [ -z "$release_sha" ] && continue
    printf '%s\n' "$release_sha"
    return 0
  done < <(
    git log \
      --first-parent \
      --grep="^docs(release-notes): ${RELEASE_CHANNEL} notes for .* \\[skip ci\\]$" \
      --format='%H' \
      "$start_ref"
  )

  return 1
}

RANGE_END="$(git rev-parse HEAD)"
if _is_release_notes_commit HEAD; then
  RANGE_END="$(git rev-parse --verify HEAD^1)"
fi

PREV_MERGE=""
if [ -n "${PREV_MERGE_OVERRIDE:-}" ]; then
  if ! _is_valid_ancestor "$PREV_MERGE_OVERRIDE"; then
    echo "::error::PREV_MERGE_OVERRIDE '${PREV_MERGE_OVERRIDE}' is not a valid ancestor commit." >&2
    exit 1
  fi

  # Explicit override — useful for manual workflow_dispatch runs / local testing.
  PREV_MERGE="$PREV_MERGE_OVERRIDE"
elif _is_valid_ancestor "${BEFORE_SHA:-}"; then
  # The branch tip immediately before this push: the precise last-deploy boundary.
  PREV_MERGE="$BEFORE_SHA"
else
  case "${BEFORE_SHA:-}" in
    "" | *[!0]*)
      ;;
    *)
      # GitHub uses the all-zero SHA when a branch is created. Treat it as an
      # unavailable event boundary and continue to the release-notes fallback.
      BEFORE_SHA=""
      ;;
  esac

  if [ -n "${BEFORE_SHA:-}" ]; then
    echo "::error::BEFORE_SHA '${BEFORE_SHA}' is not a valid ancestor of HEAD. Provide PREV_MERGE_OVERRIDE with the intended ${RELEASE_CHANNEL} deploy boundary." >&2
    exit 1
  fi

  PREV_MERGE="$(_find_previous_release_notes_commit "$RANGE_END" || true)"
  if [ -z "$PREV_MERGE" ]; then
    echo "::error::No previous ${RELEASE_CHANNEL} deploy boundary found. Provide PREV_MERGE_OVERRIDE for the first manual run." >&2
    exit 1
  fi
fi

# --- 2. Build git range -------------------------------------------------------
PREV_MERGE="$(git rev-parse "${PREV_MERGE}^{commit}")"
RANGE="${PREV_MERGE}..${RANGE_END}"
if [ "$(git rev-list --count "$RANGE")" -eq 0 ]; then
  echo "::error::Git range '${RANGE}' does not contain any commits. Choose a boundary before HEAD." >&2
  exit 1
fi

# --- 3. Collect PR numbers for every commit in range, batched ----------------
# Avoid mapfile / declare -A for bash 3.2 compat (macOS default shell). Regular
# indexed arrays (`arr=()` / `arr+=(...)`) are fine — they've been in bash
# since 2.x, unlike declare -A / mapfile which need bash 4+.
commit_shas=()
while IFS= read -r _sha; do
  [ -z "$_sha" ] && continue
  commit_shas+=("$_sha")
done < <(git log --format='%H' "$RANGE")

pr_numbers_raw=""
direct_commit_shas=""
association_lookup_failed=false

_total="${#commit_shas[@]}"
_i=0
while [ "$_i" -lt "$_total" ]; do
  _chunk=("${commit_shas[@]:$_i:$COMMIT_CHUNK_SIZE}")

  # One GraphQL request resolves the whole chunk: alias each commit as
  # c0, c1, ... and ask for its associated PR number, instead of the naive
  # one-REST-call-per-commit approach this replaces. `-F owner='{owner}' -F
  # repo='{repo}'` reuses gh's own placeholder substitution (the same
  # mechanism the original repos/{owner}/{repo}/... REST calls relied on)
  # instead of a separate `gh repo view` round trip.
  _query="query(\$owner: String!, \$repo: String!) {"$'\n'"  repository(owner: \$owner, name: \$repo) {"
  _idx=0
  for _sha in "${_chunk[@]}"; do
    _query="${_query}"$'\n'"    c${_idx}: object(oid: \"${_sha}\") { ... on Commit { associatedPullRequests(first: 5) { nodes { number } } } }"
    _idx=$((_idx + 1))
  done
  _query="${_query}"$'\n'"  }"$'\n'"}"

  if ! _response="$(gh api graphql -F owner='{owner}' -F repo='{repo}' -f query="${_query}" 2>/dev/null)"; then
    association_lookup_failed=true
    break
  fi

  _idx=0
  for _sha in "${_chunk[@]}"; do
    _nums="$(printf '%s' "$_response" | jq -r --arg k "c${_idx}" \
      'try (.data.repository[$k].associatedPullRequests.nodes[].number) catch empty' 2>/dev/null)" || _nums=""
    if [ -n "$_nums" ]; then
      pr_numbers_raw="${pr_numbers_raw}${_nums}"$'\n'
    else
      direct_commit_shas="${direct_commit_shas}${_sha}"$'\n'
    fi
    _idx=$((_idx + 1))
  done

  _i=$((_i + COMMIT_CHUNK_SIZE))
done

if [ "$association_lookup_failed" = "true" ]; then
  echo "::warning::GitHub PR association lookup failed for range ${RANGE}; using the complete git log instead." >&2
  pr_numbers=""
  pr_count=0
  direct_commit_shas=""
else
  pr_numbers="$(printf '%s' "$pr_numbers_raw" | grep -E '^[0-9]+$' | sort -un || true)"
  pr_count="$(printf '%s' "$pr_numbers" | grep -c . || true)"
fi

# --- 4. Build context document -----------------------------------------------
RELEASE_DATE="$(date -u +%Y-%m-%d)"

_tmpdir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
CONTEXT_FILE="$(mktemp "${_tmpdir}/release-notes-context-XXXXXX")"

{
  echo "# ${RELEASE_LABEL} release context — ${RELEASE_DATE}"
  echo
  echo "- Release date: ${RELEASE_DATE}"
  echo "- Git range: ${RANGE}"
  echo "- Previous boundary commit: ${PREV_MERGE}"
  echo
} > "$CONTEXT_FILE"

if [ "${pr_count:-0}" -gt 0 ]; then
  # Fetch PR detail in chunks of PR_CHUNK_SIZE via one GraphQL request per
  # chunk (aliased p<number> fields), instead of one `gh pr view` call per PR.
  # Buffer into a variable first so we can distinguish "all fetches failed"
  # from "fetches succeeded" — writing straight to the context file and
  # swallowing per-PR errors would let a total failure (auth, rate limit, or
  # network) slip through: the header would still claim "Merged Pull Requests
  # (N)" while every body is missing, and the pipeline would generate notes
  # from an empty context.
  pr_num_array=()
  while IFS= read -r _num; do
    [ -z "$_num" ] && continue
    pr_num_array+=("$_num")
  done < <(printf '%s\n' "$pr_numbers")

  _pr_details=""
  _pr_ok=0
  _pr_failed=""
  _context_bytes_used=0
  _omitted_pr_count=0
  _cap_hit=false

  _total="${#pr_num_array[@]}"
  _i=0
  while [ "$_i" -lt "$_total" ]; do
    _chunk=("${pr_num_array[@]:$_i:$PR_CHUNK_SIZE}")

    _query="query(\$owner: String!, \$repo: String!) {"$'\n'"  repository(owner: \$owner, name: \$repo) {"
    for _num in "${_chunk[@]}"; do
      _query="${_query}"$'\n'"    p${_num}: pullRequest(number: ${_num}) { number title body author { login } labels(first: 10) { nodes { name } } mergedAt }"
    done
    _query="${_query}"$'\n'"  }"$'\n'"}"

    if ! _response="$(gh api graphql -F owner='{owner}' -F repo='{repo}' -f query="${_query}" 2>/dev/null)"; then
      for _num in "${_chunk[@]}"; do
        _pr_failed="${_pr_failed}${_num} "
      done
      _i=$((_i + PR_CHUNK_SIZE))
      continue
    fi

    for _num in "${_chunk[@]}"; do
      # Once at least one PR has been added, respect the cap. The very first
      # PR is always let through even if its (already-truncated) body alone
      # exceeds the cap — otherwise a cap set smaller than a single PR entry
      # would omit everything and the "every lookup failed" guard below would
      # misfire on a size-cap situation instead of a real fetch failure.
      if [ "$_cap_hit" = "true" ] && [ "$_pr_ok" -gt 0 ]; then
        _omitted_pr_count=$((_omitted_pr_count + 1))
        continue
      fi

      # Truncate an oversized PR body up front so one huge description can't
      # blow the size cap on its own and starve every PR after it.
      _detail="$(printf '%s' "$_response" | jq -r --arg k "p${_num}" --argjson maxlen "$PR_BODY_MAX_CHARS" '
        try (
          .data.repository[$k] as $pr |
          if $pr == null then empty else
            ($pr.body // "") as $body |
            (if ($body | length) > $maxlen
              then ($body[0:$maxlen] + "\n\n...[description truncated, " + (($body | length) - $maxlen | tostring) + " more characters omitted]")
              else $body end) as $truncated |
            "### PR #\($pr.number): \($pr.title)\n" +
            "- Author: \($pr.author.login // "unknown")\n" +
            "- Labels: \((([$pr.labels.nodes[].name] | join(", ")) | select(length > 0)) // "none")\n" +
            "- Merged: \($pr.mergedAt // "unknown")\n\n" +
            (if ($truncated | length) > 0 then "Description:\n\($truncated)\n" else "Description: (none)\n" end)
          end
        ) catch empty
      ' 2>/dev/null)" || _detail=""

      if [ -z "$_detail" ]; then
        _pr_failed="${_pr_failed}${_num} "
        continue
      fi

      _detail_bytes="$(printf '%s' "$_detail" | wc -c | tr -d ' ')"
      if [ "$_pr_ok" -gt 0 ] && [ "$((_context_bytes_used + _detail_bytes))" -gt "$CONTEXT_MAX_BYTES" ]; then
        _cap_hit=true
        _omitted_pr_count=$((_omitted_pr_count + 1))
        continue
      fi

      _context_bytes_used=$((_context_bytes_used + _detail_bytes))
      _pr_ok=$((_pr_ok + 1))
      _pr_details="${_pr_details}${_detail}"$'\n\n'
    done

    _i=$((_i + PR_CHUNK_SIZE))
  done

  if [ "$_pr_ok" -eq 0 ]; then
    echo "::error::Enumerated ${pr_count} merged PR(s) for range ${RANGE} but every PR-detail lookup failed (auth, rate limit, or network). Refusing to generate release notes from empty PR context." >&2
    rm -f "$CONTEXT_FILE"
    exit 1
  fi

  if [ -n "$_pr_failed" ]; then
    echo "::warning::Failed to fetch detail for PR(s): ${_pr_failed% }. Release notes will omit them." >&2
  fi

  if [ "$_omitted_pr_count" -gt 0 ]; then
    echo "::warning::Context size cap (${CONTEXT_MAX_BYTES} bytes) reached; omitted ${_omitted_pr_count} PR(s) from the generated context. See 'git log ${RANGE}' for the full list." >&2
  fi

  {
    echo "## Merged Pull Requests (${_pr_ok})"
    echo
    printf '%s' "$_pr_details"
    if [ "$_omitted_pr_count" -gt 0 ]; then
      echo "_(${_omitted_pr_count} additional merged PR(s) omitted — context size cap reached. See \`git log ${RANGE}\` for the full list.)_"
      echo
    fi
  } >> "$CONTEXT_FILE"

  if [ -n "$direct_commit_shas" ]; then
    {
      echo
      echo "## Direct Commits"
      echo
      while IFS= read -r _sha; do
        [ -z "$_sha" ] && continue
        git show -s --format='- %s (%h) by %an' "$_sha"
      done < <(printf '%s' "$direct_commit_shas")
      echo
    } >> "$CONTEXT_FILE"
  fi
else
  # --- Fallback: raw git log --------------------------------------------------
  {
    echo "## Commits (PR data unavailable — git log fallback)"
    echo
    git log --format='- %s (%h) by %an' "$RANGE"
    echo
  } >> "$CONTEXT_FILE"
fi

# --- 5. Stable content hash ---------------------------------------------------
# Exclude both date-bearing lines so the same deploy context has the same hash
# when a workflow is re-run on a later UTC date.
CONTEXT_HASH="$(
  sed \
    -e '/^# .* release context — /d' \
    -e '/^- Release date:/d' \
    "$CONTEXT_FILE" |
    shasum -a 256 |
    awk '{print $1}'
)"

# --- 6. Emit outputs ----------------------------------------------------------
emit_output "context_file"  "$CONTEXT_FILE"
emit_output "context_hash"  "$CONTEXT_HASH"
emit_output "date_slug"     "$RELEASE_DATE"
emit_output "range"         "$RANGE"
