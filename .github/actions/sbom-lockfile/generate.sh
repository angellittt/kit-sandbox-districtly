#!/usr/bin/env bash
# Generates a CycloneDX 1.6 SBOM from a JS lockfile with cdxgen.
# Shared by the sbom-lockfile composite action and `pnpm sbom`, so CI and a
# local run use the exact same command.
#
# Usage:
#   generate.sh --name <name> [--mode prod|full] [--path <dir>]
#               [--workspace <dir>] [--output-dir <dir>] [--fetch-licenses]
#
#   --mode full  every package in the lockfile, dev deps included (default)
#   --mode prod  only the production dependency tree of --workspace (or of the
#                root package when --workspace is omitted)
#   --fetch-licenses  look up each package's license on the npm registry. A
#                lockfile has no license data, so without this the SBOM has
#                none. Slower (about a minute for ~800 packages).
#
# Env:
#   CDXGEN_VERSION  cdxgen version to run through npx (default below)
#   CDXGEN          path to a cdxgen binary to run instead of npx cdxgen, e.g.
#                   one installed from the lockfile (also used by the tests)
#
# Prints the SBOM file path as the last line of output.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CDXGEN_VERSION="${CDXGEN_VERSION:-12.8.4}"

mode="full"
name=""
project="."
workspace=""
output_dir="sbom"
fetch_licenses=""

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --path) project="$2"; shift 2 ;;
    --workspace) workspace="$2"; shift 2 ;;
    --output-dir) output_dir="$2"; shift 2 ;;
    --fetch-licenses) fetch_licenses="true"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$mode" != "prod" ] && [ "$mode" != "full" ]; then
  echo "--mode must be prod or full (got \"$mode\")" >&2
  exit 2
fi
if [ -z "$name" ]; then
  echo "--name is required" >&2
  exit 2
fi

mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
out="$output_dir/$name.cdx.json"

if [ -n "${CDXGEN:-}" ]; then
  cdxgen=("$CDXGEN")
else
  cdxgen=(npx --yes "@cyclonedx/cdxgen@$CDXGEN_VERSION")
fi

# --no-install-deps: read the lockfile only, never run an install.
raw="$out"
if [ "$mode" = "prod" ]; then
  raw="$(mktemp)"
  trap 'rm -f "$raw"' EXIT
fi
FETCH_LICENSE="$fetch_licenses" "${cdxgen[@]}" -t js --spec-version 1.6 --no-install-deps -o "$raw" "$project" >&2

if [ "$mode" = "prod" ]; then
  node "$here/prune-bom.mjs" "$raw" "$out" "$project" ${workspace:+"$workspace"} >&2
fi

echo "$out"
