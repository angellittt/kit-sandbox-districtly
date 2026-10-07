<objective>
Verify the QA/staging release-notes pipeline is correctly wired up and document what secrets need to be added in GitHub. This is the final validation step after scripts (prompt 001) and workflow (prompt 002) have been created.
</objective>

<context>
Files created in previous steps:
- ./scripts/release-notes/collect-context.sh
- ./scripts/release-notes/anthropic-generate.sh
- ./scripts/release-notes/update-index.sh
- ./.github/workflows/staging-release-notes.yml

Read CLAUDE.md for project conventions.
</context>

<requirements>
Perform these verification checks and fix any issues found:

### 1. Script syntax validation

Run `bash -n` on all three scripts and report results:

```
bash -n scripts/release-notes/collect-context.sh
bash -n scripts/release-notes/anthropic-generate.sh
bash -n scripts/release-notes/update-index.sh
```

### 2. YAML validation

Check the workflow is valid YAML:

```
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/staging-release-notes.yml'))" && echo "YAML OK"
```

### 3. Secret references audit

Grep for any hardcoded secrets, API keys, or webhook URLs:

```
grep -rn "sk-ant\|hooks.slack\|xoxb-\|xapp-" scripts/release-notes/ .github/workflows/staging-release-notes.yml
```

This should return NO matches.

### 4. Self-trigger guard

Confirm `[skip ci]` appears in the commit step:

```
grep -n "skip ci" .github/workflows/staging-release-notes.yml
```

### 5. File permissions

```
ls -la scripts/release-notes/
```

All .sh files should show execute bit (`-rwxr-xr-x` or similar).

### 6. Dry-run the collect-context script against real history (not optional — do this)

With `gh` authenticated locally, run it against this repo's own history using a real merge/PR boundary, and read the generated context file, not just the script's exit code:

```
PREV_MERGE_OVERRIDE=<some older commit sha> bash scripts/release-notes/collect-context.sh
```

(Run this from a checkout with a `github.com` remote configured — `gh`'s own
`{owner}`/`{repo}` placeholder resolves the repository from that remote, the
same way the workflow does in Actions. Set `GH_REPO=<owner>/<repo>` instead if
you need to point at a different repository.)

Confirm the printed `context_file` actually contains real PR titles/bodies (proves the GraphQL batching works against the live API, not just against a mocked `gh`), and that an oversized PR body gets truncated rather than blowing up the file.

### 7. Regression-check the scaling fix

Re-run step 6 with an artificially tiny `CONTEXT_MAX_BYTES` (e.g. `CONTEXT_MAX_BYTES=1500`) and confirm:

- The script still exits 0 and writes a context file (it must never hard-error just because the cap was reached)
- At least the first PR is always included, even if its truncated body alone exceeds the cap
- Remaining PRs are omitted with a note pointing at `git log <range>` for the full list

### 8. Document required secrets

Create `./release-notes/README.md` documenting:

- What this pipeline does
- Required GitHub secrets: `ANTHROPIC_API_KEY` (required), `SLACK_WEBHOOK_URL` (optional)
- Where to add them: GitHub repo Settings → Secrets and variables → Actions
- File structure explanation: release-notes/<qa|staging>/YYYY-MM-DD/qa.md and client.md
- How to manually trigger: Actions tab → "QA and Staging Release Notes" → Run workflow
- Link to Anthropic console for API key: https://console.anthropic.com/settings/keys
  </requirements>

<output>
- Fix any issues found during verification (edit the scripts/workflow files directly)
- Create `./release-notes/README.md` with setup documentation
- Print a final summary of all checks: PASS/FAIL for each item
</output>

<success_criteria>

- All 3 scripts pass `bash -n` with zero errors
- Workflow YAML is valid
- Zero matches for hardcoded secrets grep
- [skip ci] confirmed in workflow
- All scripts are executable
- A real dry-run against this repo's own history produced genuine PR content, not just a clean exit code
- The tiny-cap regression check confirms the size cap degrades gracefully instead of erroring out
- release-notes/README.md exists with setup instructions
  </success_criteria>
  </output>
