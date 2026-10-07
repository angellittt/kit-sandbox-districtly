<objective>
Create the GitHub Actions workflow that runs the QA/staging release-notes pipeline and posts a Slack notification.

This workflow triggers on every push to `qa` or `staging`, generates QA and client release notes via Anthropic AI, commits them back to the repo, and posts a Slack summary with a link to the full notes in GitHub.
</objective>

<context>
Project: this fullstack-starter-template monorepo
Branches: qa, staging (RELEASE_CHANNEL derived from `github.ref_name`)
Scripts already created in prompt 001: ./scripts/release-notes/collect-context.sh, anthropic-generate.sh, update-index.sh
Existing workflows to reference for CI patterns: @.github/workflows/code-coverage.yml

Required GitHub secrets:

- `ANTHROPIC_API_KEY` — Anthropic API key for Claude (required; the workflow fails fast if missing)
- `SLACK_WEBHOOK_URL` — Slack incoming webhook URL (optional — the Slack step skips itself with a message if unset, since not every project wires up Slack)
- `GITHUB_TOKEN` — auto-provided by GitHub Actions, used for `gh`/GraphQL lookups and `git push`

Read CLAUDE.md for project conventions before writing anything.
</context>

<requirements>
Create `.github/workflows/staging-release-notes.yml` with:

### Trigger

```yaml
on:
  push:
    branches: [qa, staging]
```

Also add `workflow_dispatch` (with an optional `prev_merge_override` input) for manual runs.

### Concurrency

Serialize runs per branch so overlapping pushes don't race on the git commit-back:

```yaml
concurrency:
  group: release-notes-${{ github.ref_name }}
  cancel-in-progress: false
```

### Permissions

```yaml
permissions:
  contents: write
  pull-requests: read
```

### Environment variables

```yaml
env:
  ANTHROPIC_MODEL: claude-sonnet-4-6
  RELEASE_CHANNEL: ${{ github.ref_name }}
```

### Jobs — single job `release-notes` on `ubuntu-latest`, timeout 20 minutes

Steps in order:

1. **Checkout** with `fetch-depth: 0` and `fetch-tags: true` (full history needed for boundary detection)
2. **Validate release channel** — fail fast if triggered from anything other than `qa`/`staging` (defensive; `workflow_dispatch` can be run from any branch)
3. **Verify ANTHROPIC_API_KEY** — fail fast with a helpful error message if missing
4. **Collect context** — run `bash scripts/release-notes/collect-context.sh`, pipe to `$GITHUB_OUTPUT`
5. **Check idempotency** — read `.context-hash` files under `release-notes/$RELEASE_CHANNEL/` on the remote branch; if any match `steps.ctx.outputs.context_hash`, set `changed=false` and skip generation steps
6. **Build system prompts** — write two system prompt files to `$RUNNER_TEMP/prompts/`:
   - `qa-system.txt`: Technical QA notes prompt (see implementation section)
   - `client-system.txt`: Non-technical client notes prompt (see implementation section)
7. **Generate QA notes** — call `bash scripts/release-notes/anthropic-generate.sh` with the qa system prompt, context file, output `release-notes/$RELEASE_CHANNEL/$DATE_SLUG/qa.md`; set `MAX_TOKENS=3000`
8. **Generate client notes** — same, output `release-notes/$RELEASE_CHANNEL/$DATE_SLUG/client.md`; set `MAX_TOKENS=800`
9. **Update index** — run `bash scripts/release-notes/update-index.sh $DATE_SLUG`
10. **Commit notes back** — git config bot identity, add `release-notes/$RELEASE_CHANNEL/`, commit with `[skip ci]`, rebase-and-retry on push rejection, push to `origin HEAD:$RELEASE_CHANNEL`
11. **Post to Slack** — use `curl` with the `SLACK_WEBHOOK_URL` secret; skip gracefully (not an error) if the secret isn't set

### System prompt content (write these inline as heredocs in the workflow)

Both prompts must:

- Reference this repo's two apps generically (`apps/web` React frontend, `apps/api` backend API) — no hardcoded project or client name
- Preserve whichever environment name (`QA` / `Staging`) the context identifies, rather than hardcoding one

**QA system prompt** (`qa-system.txt`): technical audience — frontend changes, backend changes & their frontend impact, breaking changes/migration notes, internal/chore. One bullet per meaningful change, reference PR numbers as "(#NNN)".

**Client system prompt** (`client-system.txt`): non-technical audience (product owner / stakeholder) — plain English, frontend-visible changes only, no PR numbers or jargon, 3-5 bullets, under 600 characters, with a fallback line for "no user-facing changes."

### Slack notification payload

Post to `SLACK_WEBHOOK_URL` using `curl`, only when the secret is set and notes were newly generated. The message must include:

- A brief header: `:rocket: *{ENVIRONMENT} updated — {DATE}*`
- One-sentence excerpt pulled from the client notes (first bullet point)
- A link to the QA notes and a link to the client notes, both under `release-notes/$RELEASE_CHANNEL/$DATE_SLUG/`

Use `jq` to safely construct the Slack JSON payload (never interpolate raw file content into JSON strings directly).
</requirements>

<implementation>
Critical constraints:

1. **`[skip ci]`** on the commit message — this workflow must not re-trigger itself when it pushes the notes back.

2. **Idempotency guard** — if a second push to the same channel happens with the same PR set (e.g., a CI retry), do NOT regenerate notes. The `.context-hash` file prevents LLM nondeterminism from creating noisy commits.

3. **Slack only fires when `changed == 'true'` and the notes were actually published** — skip Slack notification if notes were unchanged (no point notifying about a no-op run) or the webhook isn't configured.

4. **Graceful Slack failure** — add `continue-on-error: true` to the Slack step so a Slack outage never blocks the release-notes commit.

5. **Slack payload safety** — use `jq -n --arg` flags to construct the JSON body. Never use `echo "{...${VAR}...}"` as it breaks on special characters in PR bodies.

6. **Bot git identity**:
   ```
   git config user.name "github-actions[bot]"
   git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
   ```
   </implementation>

<output>
Create this file:
- `./.github/workflows/staging-release-notes.yml` — complete, runnable GitHub Actions workflow
</output>

<verification>
After writing the workflow:
1. Run `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/staging-release-notes.yml'))"` and verify YAML is well-formed
2. Confirm trigger is `push: branches: [qa, staging]`
3. Confirm `[skip ci]` is in the commit message
4. Confirm `SLACK_WEBHOOK_URL` is only referenced as `${{ secrets.SLACK_WEBHOOK_URL }}` — never hardcoded, and the step degrades gracefully when it's unset
5. Confirm `ANTHROPIC_API_KEY` is only referenced as `${{ secrets.ANTHROPIC_API_KEY }}`
6. Confirm both QA and client note paths use `release-notes/$RELEASE_CHANNEL/` (not a hardcoded channel name)
7. Confirm Slack step has `continue-on-error: true`
8. Confirm concurrency group is set to prevent parallel runs per channel
</verification>

<success_criteria>

- .github/workflows/staging-release-notes.yml exists and is valid YAML
- Triggers on push to qa or staging (+ workflow_dispatch)
- Generates qa.md and client.md under release-notes/<channel>/YYYY-MM-DD/
- Commits back with [skip ci] so it cannot self-trigger
- Posts a Slack notification with excerpt and links only when notes are newly generated and the webhook secret exists
- All secrets referenced via ${{ secrets.* }} — no hardcoded values
- Slack step has continue-on-error: true
  </success_criteria>
  </output>
