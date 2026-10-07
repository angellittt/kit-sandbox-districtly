#!/usr/bin/env bash
#
# update-index.sh — maintain release-notes/$RELEASE_CHANNEL/INDEX.md.
#
# Adds a new row for the given date (newest first). Idempotent: if the date
# already appears in the file, the script exits without changes. Uses an atomic
# temp-file + mv write pattern.
#
# USAGE
#   RELEASE_CHANNEL=qa bash scripts/release-notes/update-index.sh <YYYY-MM-DD>
#   Defaults to RELEASE_CHANNEL=staging.

set -euo pipefail

DATE_SLUG="${1:?usage: update-index.sh <YYYY-MM-DD>}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
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

INDEX_FILE="${REPO_ROOT}/release-notes/${RELEASE_CHANNEL}/INDEX.md"

# Canonical file header — written once when INDEX.md does not yet exist.
HEADER="# ${RELEASE_LABEL} Release Notes Index

| Date | QA Notes | Client Notes |
|------|----------|--------------|"

NEW_ROW="| ${DATE_SLUG} | [QA notes](${DATE_SLUG}/qa.md) | [Client notes](${DATE_SLUG}/client.md) |"

# Create INDEX.md (and any missing parent directories) when absent.
if [ ! -f "$INDEX_FILE" ]; then
  mkdir -p "$(dirname "$INDEX_FILE")"
  printf '%s\n' "$HEADER" > "$INDEX_FILE"
fi

# Idempotency guard: skip if this date is already present.
if grep -qF "$DATE_SLUG" "$INDEX_FILE"; then
  echo "Index already contains ${DATE_SLUG} — skipping."
  exit 0
fi

# Insert the new row immediately after the separator line (|---...|) so entries
# stay newest-first. Uses a while-read loop (bash 3.2 compat — no mapfile).
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

_inserted=false
while IFS= read -r _line || [ -n "$_line" ]; do
  printf '%s\n' "$_line" >> "$tmp"
  if [ "$_inserted" = "false" ]; then
    case "$_line" in
      \|---*)
        printf '%s\n' "$NEW_ROW" >> "$tmp"
        _inserted=true
        ;;
    esac
  fi
done < "$INDEX_FILE"

# Self-heal a malformed index: if the separator row was missing, the row above
# was never inserted. Append the canonical table header + row so the release is
# never silently dropped from the index.
if [ "$_inserted" = "false" ]; then
  echo "Warning: ${INDEX_FILE} is missing a table separator row — repairing." >&2
  {
    printf '\n%s\n' "| Date | QA Notes | Client Notes |"
    printf '%s\n' "|------|----------|--------------|"
    printf '%s\n' "$NEW_ROW"
  } >> "$tmp"
fi

mv "$tmp" "$INDEX_FILE"
echo "Updated ${INDEX_FILE} (added ${DATE_SLUG})"
