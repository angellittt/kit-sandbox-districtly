#!/usr/bin/env bash
# Runs a hook from packages/claude-hooks with the Node version in mise.toml.
# Usage: `run-hook.sh pre-bash 20`. The hooks are TypeScript run from source,
# so they need Node 24.
#
# If a hook crashes, or runs past its `timeout` in .claude/settings.json,
# Claude Code ignores it and runs the tool call anyway. To stop that, this
# script kills the hook after `limit` seconds (set it a few seconds under the
# `timeout`) and exits 2 with setup steps.
hook="$1"
limit="${2:-20}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/packages/claude-hooks/src/bin/$hook.ts"

if command -v mise >/dev/null 2>&1; then
  # No auto-install: a tool that isn't installed yet (say, Preloop) must not
  # stop the hooks from running. The push gate reports a missing Preloop itself.
  MISE_EXEC_AUTO_INSTALL=0 mise exec --cd "$root" -- node "$script" <&0 &
else
  node "$script" <&0 &
fi
pid=$!
# Send the timer's output nowhere. Otherwise a leftover `sleep` keeps the
# hook's stdout open after the hook ends.
(sleep "$limit" && kill -TERM "$pid") </dev/null >/dev/null 2>&1 &
watchdog=$!
wait "$pid"
status=$?
kill "$watchdog" 2>/dev/null

if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then
  if [ "$status" -eq 143 ]; then
    problem="took longer than ${limit}s"
  else
    problem="couldn't run (exit $status)"
  fi
  if [ "$hook" = "pre-bash" ]; then
    outcome="so this command was blocked"
  elif [ "$hook" = "pre-edit" ]; then
    outcome="so this edit was blocked"
  else
    # PostToolUse runs after the edit, so it can't undo it; exit 2 only shows Claude this message.
    outcome="so the edited file was not formatted or linted"
  fi
  cat >&2 <<MSG
The Claude Code "$hook" hook $problem, $outcome.
Ask the developer to set up the repo's tools: install mise, run \`mise trust && mise install\`
in the repo, and make sure mise is on the PATH Claude Code sees (see "AI agent hooks" in the Readme).
MSG
  exit 2
fi
exit "$status"
