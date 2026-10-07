#!/usr/bin/env bash

# Standalone tests for serve.sh. Each test puts a fake `preloop` (logs its
# arguments, PRELOOP_RUNNER_BUNDLE and the runner pool settings) and a fake `curl` (serves files from a
# local "release" dir) on PATH, and checks what got installed and run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVE="${SCRIPT_DIR}/serve.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

FAKE_BIN="$TEST_TMP/bin"
BASE_PATH="/usr/local/bin:/usr/bin:/bin"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

case "$(uname -m)" in
  x86_64 | amd64) TRIPLE="x86_64-unknown-linux-gnu" ;;
  *) TRIPLE="aarch64-unknown-linux-gnu" ;;
esac
ASSET="preloop-runner-$TRIPLE"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/preloop" <<'SH'
#!/usr/bin/env bash
if [ "$1" = version ]; then echo "preloop ${FAKE_VERSION:-1.2.3}"; exit 0; fi
echo "$* bundle=${PRELOOP_RUNNER_BUNDLE:-}" >> "$FAKE_LOG"
echo "pool=${PRELOOP_RUNNER_POOL_ENABLED:-} size=${PRELOOP_RUNNER_POOL_SIZE:-}" >> "$FAKE_LOG.pool"
SH
# Fake curl: `curl -fsSL <url> [-o <file>]`, mapping the URL's path onto
# $FAKE_RELEASES and logging each URL to $FAKE_LOG.curl.
cat > "$FAKE_BIN/curl" <<'SH'
#!/usr/bin/env bash
url="" out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
echo "$url" >> "$FAKE_LOG.curl"
src="$FAKE_RELEASES/${url#fake://}"
[ -f "$src" ] || exit 22
if [ -n "$out" ]; then cp "$src" "$out"; else cat "$src"; fi
SH
chmod +x "$FAKE_BIN/preloop" "$FAKE_BIN/curl"

# Sets up a release dir with a runner asset and its checksum for $1.
make_release() {
  local dir="$TEST_TMP/$2/releases/v$1"
  mkdir -p "$dir"
  echo "runner $1" > "$dir/$ASSET"
  echo "$(sha256 "$dir/$ASSET")  dist/$ASSET" > "$dir/$ASSET.sha256"
}

run_serve() {
  local name="$1"
  shift
  (
    cd "$TEST_TMP"
    PATH="$FAKE_BIN:$BASE_PATH" \
      PRELOOP_HOME="$TEST_TMP/$name/home" \
      PRELOOP_RELEASES_URL="fake://" \
      FAKE_RELEASES="$TEST_TMP/$name/releases" \
      FAKE_LOG="$TEST_TMP/$name/log" \
      bash "$SERVE" "$@"
  )
}

test_installs_the_runner_and_starts_serve_with_it() {
  local name=install
  make_release 1.2.3 "$name"
  run_serve "$name" --verbose > "$TEST_TMP/$name/out" 2>&1 || fail "serve.sh failed: $(cat "$TEST_TMP/$name/out")"
  local bundle="$TEST_TMP/$name/home/runner/v1.2.3/$TRIPLE"
  [ -x "$bundle/preloop-runner" ] || fail "runner not installed at $bundle"
  grep -q "runner 1.2.3" "$bundle/preloop-runner" || fail "installed the wrong runner"
  grep -qx "serve --verbose bundle=$bundle" "$TEST_TMP/$name/log" || fail "serve not run with the bundle: $(cat "$TEST_TMP/$name/log")"
}

test_reuses_an_installed_runner() {
  local name=reuse
  make_release 1.2.3 "$name"
  run_serve "$name" > /dev/null 2>&1 || fail "first run failed"
  rm "$TEST_TMP/$name/log.curl"
  run_serve "$name" > /dev/null 2>&1 || fail "second run failed"
  [ ! -f "$TEST_TMP/$name/log.curl" ] || fail "downloaded again: $(cat "$TEST_TMP/$name/log.curl")"
  [ "$(grep -c '^serve' "$TEST_TMP/$name/log")" -eq 2 ] || fail "serve should run both times"
}

test_refuses_a_runner_with_a_bad_checksum() {
  local name=badsum
  make_release 1.2.3 "$name"
  echo "tampered" > "$TEST_TMP/$name/releases/v1.2.3/$ASSET"
  if run_serve "$name" > "$TEST_TMP/$name/out" 2>&1; then fail "should fail on a checksum mismatch"; fi
  grep -q "checksum mismatch" "$TEST_TMP/$name/out" || fail "no checksum message: $(cat "$TEST_TMP/$name/out")"
  [ ! -e "$TEST_TMP/$name/home/runner/v1.2.3/$TRIPLE/preloop-runner" ] || fail "installed a bad runner"
  [ ! -f "$TEST_TMP/$name/log" ] || fail "serve should not start"
}

test_fails_when_the_release_has_no_runner() {
  local name=missing
  mkdir -p "$TEST_TMP/$name/releases"
  if run_serve "$name" > "$TEST_TMP/$name/out" 2>&1; then fail "should fail without a runner asset"; fi
  grep -q "couldn't download" "$TEST_TMP/$name/out" || fail "no download message: $(cat "$TEST_TMP/$name/out")"
  [ ! -f "$TEST_TMP/$name/log" ] || fail "serve should not start"
}

test_turns_on_a_warm_pool_of_one_runner() {
  local name=pool
  make_release 1.2.3 "$name"
  run_serve "$name" > "$TEST_TMP/$name/out" 2>&1 || fail "serve.sh failed: $(cat "$TEST_TMP/$name/out")"
  grep -qx "pool=true size=1" "$TEST_TMP/$name/log.pool" || fail "warm pool not on: $(cat "$TEST_TMP/$name/log.pool")"
}

test_keeps_pool_settings_from_the_environment() {
  local name=poolenv
  make_release 1.2.3 "$name"
  PRELOOP_RUNNER_POOL_ENABLED=false PRELOOP_RUNNER_POOL_SIZE=3 run_serve "$name" > "$TEST_TMP/$name/out" 2>&1 ||
    fail "serve.sh failed: $(cat "$TEST_TMP/$name/out")"
  grep -qx "pool=false size=3" "$TEST_TMP/$name/log.pool" || fail "pool settings overridden: $(cat "$TEST_TMP/$name/log.pool")"
}

test_fails_when_preloop_is_missing() {
  local name=nopreloop
  mkdir -p "$TEST_TMP/$name/bin"
  ln -s "$FAKE_BIN/curl" "$TEST_TMP/$name/bin/curl"
  if (cd "$TEST_TMP" && PATH="$TEST_TMP/$name/bin:$BASE_PATH" bash "$SERVE") > "$TEST_TMP/$name/out" 2>&1; then
    fail "should fail without preloop"
  fi
  grep -q "mise install" "$TEST_TMP/$name/out" || fail "no setup hint: $(cat "$TEST_TMP/$name/out")"
}

test_installs_the_runner_and_starts_serve_with_it
test_reuses_an_installed_runner
test_refuses_a_runner_with_a_bad_checksum
test_fails_when_the_release_has_no_runner
test_turns_on_a_warm_pool_of_one_runner
test_keeps_pool_settings_from_the_environment
test_fails_when_preloop_is_missing

echo "serve tests passed"
