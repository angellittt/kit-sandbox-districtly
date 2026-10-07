---
name: run-ci-locally
description: Run this repo's GitHub Actions PR workflows locally with Preloop (`pnpm ci:local`) and get them green before pushing. Use before any `git push` or `gh pr create`, when a push or PR is blocked by the local CI gate, or when asked to check that CI will pass.
---

# Run CI locally

You can't `git push` or `gh pr create` in this repo until every pull_request workflow passes locally for the exact commit you push. A Claude Code hook enforces it. This skill is how you get there.

## When

- Before every push or PR. Also after any new commit: a new commit makes the old pass stale.
- When a push was blocked with "blocked until every PR check passes locally".

## Loop

1. Commit everything. `git status` must be clean (no untracked files either). A run with uncommitted changes can pass, but it writes no stamp, so the push stays blocked.
2. Run `pnpm ci:local`. It runs every workflow in `.github/workflows/` with a `pull_request` trigger through Preloop, then prints a summary:
   ```
   ci:local summary:
     pass  .github/workflows/lint.yml
     FAIL  .github/workflows/typecheck.yml
   ```
3. If everything passed, it says `Stamped <sha>, so it can be pushed.` Push now, as its own command. Don't chain it after a commit (`git commit ... && git push`): the gate checks before the commit runs, so it sees the old HEAD.
4. If something failed, fix it, commit, and go back to step 2.

## Reading failures

- Scroll up from the summary to the `==> ci:local: <workflow>` header of the failing workflow. Preloop streams each job and step. Find the first step that failed and read its output, not the last line.
- Most failures are the same as the pnpm script the step runs (`pnpm typecheck`, `pnpm lint`, `pnpm run test`, `scripts/e2e-ci.sh`). Reproduce with that script directly, it's faster than the VM. Then fix and re-run.
- To re-run only the workflow you fixed while iterating: `pnpm ci:local .github/workflows/<file>.yml`. This never writes a stamp, so finish with a full `pnpm ci:local` before pushing.
- If a step fails only in Preloop (setup, YAML, Docker, a missing tool), that's a workflow problem. That's exactly what this gate is for. Fix the workflow file.

## Don't

- Don't write, copy or touch `.git/preloop-pass`. Only `pnpm ci:local` writes it. The hooks block it anyway.
- Don't skip, disable or weaken a workflow, job or test to get green. Don't add an `if:` that skips a real check locally.
- Don't use `preloop run --push` or `preloop push` to get around the gate. They're gated too.

## When to stop and ask the developer

- `pnpm ci:local` says Preloop isn't installed, or its GitHub auth isn't set up. Show them the setup steps it printed (`mise install`, `preloop setup github --via pat --repo <owner>/<repo>`, about 80GB free disk). You can't do this for them.
- Jobs stay `Queued` with "no registered runner ... can claim the queued jobs". The engine isn't running, or it was started with plain `preloop serve` and has no runner pool. Ask the developer to run `pnpm ci:serve` in another terminal and leave it running. It's long-lived, so don't start it yourself.
- The machine can't run it: no `/dev/kvm` on Linux, not enough disk, or a `rosetta-wrapper` error on an Apple Silicon Mac (Preloop can't run Docker actions there yet, so `e2e.yml` fails). Tell the developer. They can push by hand from their own terminal.
- The same failure keeps coming back after two or three honest fixes, or it's in code you don't own. Explain what you found instead of looping.
