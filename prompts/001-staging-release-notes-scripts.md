<objective>
Create the shell scripts that power the QA/staging release-notes pipeline for this monorepo.

On every push to `qa` or `staging`, the pipeline must:

1. Collect all PRs merged since the previous push to that branch (or the full git log as fallback)
2. Generate two Markdown files via the Anthropic Messages API:
   - A **QA note** (technical — PR numbers, labels, breaking changes, migration steps)
   - A **Client note** (non-technical — plain English, user-visible features only, no jargon)
3. Commit both files back to the repo under `release-notes/<channel>/YYYY-MM-DD/`

These scripts implement a date-based release-notes pipeline for a monorepo with no `package.json` version number. Git history provides the deployment boundary.
</objective>

<context>
Project: this fullstack-starter-template monorepo (pnpm workspaces, Turborepo)
Branches: qa, staging (both trigger the same workflow, RELEASE_CHANNEL derived from the ref)
Existing CI workflows: .github/workflows/ contains code-coverage.yml, react-doctor-web.yml

Read CLAUDE.md for project conventions before writing any files.

Project-specific constraints:

- No package.json version number — use git history to find the previous push to the same channel instead
- Two distinct outputs: QA notes (technical) and client notes (non-technical)
- Files organized by date: release-notes/<channel>/YYYY-MM-DD/qa.md and client.md
- A .context-hash file alongside notes prevents regenerating when the PR set is unchanged
  </context>

<requirements>
Create three scripts under `./scripts/release-notes/`:

### 1. `collect-context.sh`

Collects the merge context for the current push:

- Detect the previous deploy boundary for RELEASE_CHANNEL, in order: an explicit override, the branch tip before this push (`github.event.before`), or the most recent `docs(release-notes): ...` commit — fail loudly if none of these resolve, rather than silently walking the whole repo history
- Build a git range: `PREV_BOUNDARY..HEAD`
- Enumerate merged PRs in that range via GitHub's GraphQL API, batching many commits into a single request instead of one REST call per commit (see the "known scaling bug" note below)
- Fall back to raw `git log --format='- %s (%h) by %an'` if the lookup fails entirely
- Write a single context file to `$RUNNER_TEMP` containing all PR titles, bodies, labels, authors — truncating oversized bodies and capping the total size so a large release can't blow past the model's input limit
- Compute a SHA-256 content hash (excluding date-bearing lines) for idempotency
- Output to `$GITHUB_OUTPUT`: `context_file`, `context_hash`, `date_slug` (format: YYYY-MM-DD), `range`

**Known scaling bug (fixed here, not in the original design):** the first version of this script called the GitHub API once per commit (to find its PR) and once per PR (to fetch its detail), one at a time, then dumped every PR body into one unbounded file. On a big release this was slow, could hit GitHub's rate limit, and could blow past the model's input size limit. This version batches both lookups via GraphQL aliasing (many items per HTTP request) and caps the context file's size (truncating oversized PR bodies, omitting PRs once the cap is reached with a note pointing at `git log` for the full list).

### 2. `anthropic-generate.sh`

Reads the system prompt and context from files, calls the Anthropic Messages API, and writes the response to the output file:

- Default model: `claude-sonnet-4-6`
- Keep the same jq-based JSON construction (no shell interpolation of user content)
- Keep the same HTTP error handling and empty-response guard

### 3. `update-index.sh`

Appends an entry to `release-notes/<channel>/INDEX.md` (create if missing):

- Format: `| YYYY-MM-DD | [QA notes](YYYY-MM-DD/qa.md) | [Client notes](YYYY-MM-DD/client.md) |`
- Prepend new entries at the top (newest first) — do not append at the bottom
- If the date already exists in the index, skip (idempotency)
  </requirements>

<implementation>
Follow these constraints exactly:

1. **No shell interpolation of prompt text** — all system prompts must be written to temp files and passed as file arguments to anthropic-generate.sh. This is critical because PR bodies contain backticks, quotes, and special characters that would break shell interpolation.

2. **QA system prompt** (write inline in the workflow, not here): Technical audience. Include PR numbers, breaking changes, migration notes. Group by frontend/backend/breaking/internal. Omit merge commits and lockfile-only changes.

3. **Client system prompt** (write inline in the workflow, not here): Non-technical audience (product owner, client stakeholders). Plain English only. No PR numbers, no technical jargon, no internal tickets. Focus on: what the user can now do, what was fixed from a user perspective. 3-5 bullets max. Under 600 characters.

4. **Bash compatibility**: Scripts must run on `ubuntu-latest` GitHub runners. No `declare -A`, no `mapfile`, no bash 4+ features besides regular indexed arrays (`arr=()` / `arr+=(...)`, which have been in bash since 2.x and are fine). Use `while read` loops instead of `mapfile`.

5. **`set -euo pipefail`** at the top of every script.

6. **`gh` authentication**: The `gh` CLI is pre-authenticated in GitHub Actions via `GITHUB_TOKEN`. Scripts must not hardcode any credentials.
   </implementation>

<output>
Create these files:
- `./scripts/release-notes/collect-context.sh` — context collection script
- `./scripts/release-notes/anthropic-generate.sh` — Anthropic API caller
- `./scripts/release-notes/update-index.sh` — INDEX.md updater

Make all three executable: `chmod +x scripts/release-notes/*.sh`
</output>

<verification>
After writing the scripts:
1. Run `bash -n scripts/release-notes/collect-context.sh` to syntax-check
2. Run `bash -n scripts/release-notes/anthropic-generate.sh` to syntax-check
3. Run `bash -n scripts/release-notes/update-index.sh` to syntax-check
4. Verify no hardcoded secrets, credentials, or repo names (use `GITHUB_REPOSITORY` / `gh repo view` for the repo slug)
5. Confirm all three files are executable (`ls -la scripts/release-notes/`)
6. Dry-run `collect-context.sh` against this repo's real history with a real `PREV_MERGE_OVERRIDE` and confirm the generated context file actually contains real, truncated PR bodies — not just that the script exits 0
</verification>

<success_criteria>

- All three scripts exist under ./scripts/release-notes/
- All three pass `bash -n` syntax check with zero errors
- collect-context.sh detects the previous boundary via git, not a package.json version
- Both GitHub lookups (commit→PR, PR→detail) are batched, not one-call-per-item
- The context file has a size cap that degrades gracefully (never silently truncates mid-PR, never errors out just because the cap was reached)
- anthropic-generate.sh uses jq for JSON construction (no shell interpolation)
- update-index.sh creates INDEX.md if missing, prepends entries, is idempotent
- No hardcoded credentials or repository names
  </success_criteria>
  </output>
