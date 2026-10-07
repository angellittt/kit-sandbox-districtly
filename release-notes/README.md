# Release Notes Pipeline

Automated, AI-generated release notes for pushes to the `qa` and `staging`
branches. On every push, the `.github/workflows/staging-release-notes.yml`
workflow:

1. Finds every PR merged (or commit landed) since the last push to that
   branch.
2. Asks Claude (via the Anthropic Messages API) to write two Markdown files:
   - `qa.md` — technical notes for the QA team (PR numbers, frontend/backend
     split, breaking changes, migration steps).
   - `client.md` — plain-English notes for a non-technical stakeholder
     (user-visible changes only, no jargon, no PR numbers).
3. Commits both files back to `release-notes/<channel>/YYYY-MM-DD/` with
   `[skip ci]` so the commit doesn't re-trigger the workflow, and updates
   `release-notes/<channel>/INDEX.md`.
4. Posts a short summary to Slack, if `SLACK_WEBHOOK_URL` is configured.

See `../prompts/00{1,2,3}-*.md` for the original design docs — kept next to
this pipeline as a build-log of why it's built the way it is, including the
scaling bug that was fixed before this was ported into this template (see
`001-staging-release-notes-scripts.md`).

## Required GitHub secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret              | Required? | Purpose                                                                                                                                                                              |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | Yes       | Calls the Anthropic Messages API to generate both note files. Get one at https://console.anthropic.com/settings/keys. The workflow fails fast with a clear error if this is missing. |
| `SLACK_WEBHOOK_URL` | No        | Posts a short summary + links to Slack when new notes are generated. If unset, the Slack step just logs that it's skipping — it never fails the workflow.                            |

`GITHUB_TOKEN` is provided automatically by GitHub Actions; no setup needed.

The "Commit notes back" step pushes directly to `qa`/`staging` (with a
rebase-and-retry loop for races with other pushes to the same branch). If
either branch has protection rules that block direct pushes, the workflow's
push will fail every run. Either keep `qa`/`staging` directly pushable, or
exempt `github-actions[bot]` from the protection rule.

## File structure

```
release-notes/
├── README.md              (this file)
├── qa/
│   ├── INDEX.md            newest-first table of every QA release
│   └── YYYY-MM-DD/
│       ├── qa.md
│       ├── client.md
│       └── .context-hash   idempotency guard, not meant to be read directly
└── staging/
    ├── INDEX.md
    └── YYYY-MM-DD/
        ├── qa.md
        ├── client.md
        └── .context-hash
```

## Manually triggering a run

Actions tab → **QA and Staging Release Notes** → **Run workflow** → pick the
`qa` or `staging` branch. Optionally set `prev_merge_override` to a specific
commit SHA if you need to regenerate notes from a boundary other than the
auto-detected one (e.g. the very first run on a branch, before any
`docs(release-notes): ...` commit exists to detect).

## Scaling note

The context-collection step (`scripts/release-notes/collect-context.sh`)
batches its GitHub API lookups (via GraphQL, many items per request) instead
of calling the API once per commit and once per PR, and caps the PR-body
portion of the context so a release dominated by large PR descriptions can't
blow past Claude's input limit. The header, direct-commits list, and git-log
fallback are not bounded by this cap. See the comments at the top of that
script for the tuning knobs (`COMMIT_CHUNK_SIZE`, `PR_CHUNK_SIZE`,
`PR_BODY_MAX_CHARS`, `CONTEXT_MAX_BYTES`).
