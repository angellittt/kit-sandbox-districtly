#!/usr/bin/env bash
#
# anthropic-generate.sh — generate one release-notes artifact via the Anthropic
# Messages API.
#
# Usage:
#   ANTHROPIC_API_KEY=<your-anthropic-api-key> \
#   [ANTHROPIC_MODEL=claude-sonnet-4-6] \
#   [MAX_TOKENS=2000] \
#   bash scripts/release-notes/anthropic-generate.sh \
#     <system-prompt-file> <context-file> <out-file>
#
# Reads the system prompt and user content (PR/commit context) from files so
# no model text or prompt text is ever shell-interpolated. The model's text
# response is written verbatim to <out-file>. Fails loudly on a missing key,
# HTTP errors, or an empty response.

set -euo pipefail

SYSTEM_FILE="${1:?system prompt file required}"
CONTEXT_FILE="${2:?context file required}"
OUT_FILE="${3:?output file required}"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "::error::Missing ANTHROPIC_API_KEY. Add it under Settings -> Secrets and variables -> Actions." >&2
  exit 1
fi

MODEL="${ANTHROPIC_MODEL:-claude-sonnet-4-6}"
MAX_TOKENS="${MAX_TOKENS:-2000}"
API_VERSION="${ANTHROPIC_VERSION:-2023-06-01}"

if ! [[ "$MAX_TOKENS" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::MAX_TOKENS must be a positive integer, got: '${MAX_TOKENS}'" >&2
  exit 1
fi

# Build the request body with jq so the system prompt and context (which may
# contain arbitrary quotes, newlines, and backticks from PR bodies) are safely
# JSON-encoded. --rawfile reads file contents verbatim; no shell interpolation.
payload="$(jq -n \
  --arg model "$MODEL" \
  --argjson max_tokens "$MAX_TOKENS" \
  --rawfile system "$SYSTEM_FILE" \
  --rawfile content "$CONTEXT_FILE" \
  '{model: $model, max_tokens: $max_tokens, system: $system, messages: [{role: "user", content: $content}]}')"

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

http_code="$(curl -sS -o "$body_file" -w '%{http_code}' \
  https://api.anthropic.com/v1/messages \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: ${API_VERSION}" \
  -H "content-type: application/json" \
  -d "$payload")"

if [ "$http_code" != "200" ]; then
  echo "::error::Anthropic API returned HTTP ${http_code} for $(basename "$OUT_FILE")" >&2
  jq -r '.error.message // .' "$body_file" 2>/dev/null || cat "$body_file" >&2
  exit 1
fi

# Concatenate every text block in the response (usually just one).
text="$(jq -r '[.content[] | select(.type == "text") | .text] | join("")' "$body_file")"
if [ -z "$text" ]; then
  echo "::error::Anthropic API returned no text content for $(basename "$OUT_FILE")" >&2
  cat "$body_file" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"
printf '%s\n' "$text" > "$OUT_FILE"
echo "Wrote ${OUT_FILE} ($(wc -c < "$OUT_FILE" | tr -d ' ') bytes) via ${MODEL}"
