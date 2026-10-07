# SBOMs (Software Bill of Materials)

**What this is:** every deploy produces a CycloneDX SBOM, a machine-readable list of every package that ships. Client IT teams can use it to see exactly what runs in their environment. Every SBOM is also scanned with Grype for known vulnerabilities and copyleft licenses. This guide has two parts: a [dev section](#for-developers) (how it works, toggles, local runs, porting to another repo) and a [client IT section](#for-client-it-teams) you can copy and send as is.

**Format:** CycloneDX 1.6 JSON, file extension `.cdx.json`.

---

## For developers

### The two SBOM kinds

They stay as separate files on purpose. They answer different questions.

| Kind                              | What it lists                                                                                                                 | Made by                  | Where it runs                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| **Artifact** (client deliverable) | What actually ships. API: the built Docker image (npm deps plus the base image's OS packages). Web: production npm deps only. | Syft (API), cdxgen (web) | `deploy-api.yml`, `fe-web-deployment.yml`, every environment |
| **Source** (internal)             | The full `pnpm-lock.yaml`, dev deps included, for build-time supply chain visibility.                                         | cdxgen                   | `sbom-source.yml`, every PR and every push to `main`         |

Why the web SBOM comes from the lockfile: the Vite bundle merges packages into a few JS files, so scanning `dist/` can't tell which packages are inside. The lockfile can.

### Where the code lives

| Path                                                                        | What it does                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`.github/actions/sbom-image`](.github/actions/sbom-image/action.yml)       | Composite action. Syft scans an image, uploads the SBOM, optionally attaches it to the image in the registry. |
| [`.github/actions/sbom-lockfile`](.github/actions/sbom-lockfile/action.yml) | Composite action. cdxgen reads a lockfile (mode `full` or `prod`), uploads the SBOM.                          |
| [`.github/actions/sbom-scan`](.github/actions/sbom-scan/action.yml)         | Composite action. Grype scans an SBOM, checks suppressions, lists copyleft licenses, fails on a threshold.    |
| [`.github/workflows/sbom-source.yml`](.github/workflows/sbom-source.yml)    | Source SBOM on PRs and `main`, then the **Vulnerability scan** job. Also runs the tests for the actions.      |
| [`.grype.yaml`](.grype.yaml)                                                | Vulnerability suppressions (Grype's ignore list).                                                             |

All three actions take inputs for everything (image, name, path, mode, threshold) and have no paths from this repo hardcoded, so they can move to a shared org actions repo later with just a move and a tag. Third-party actions inside them are pinned by commit SHA, and the Syft, cdxgen, oras and Grype versions are pinned as input defaults.

**Licenses:** a lockfile has no license data, so the lockfile action runs cdxgen with `FETCH_LICENSE=true` (input `fetch-licenses`, on by default). cdxgen looks up each package's license on the npm registry. That adds about a minute for ~800 packages. Syft reads licenses from the image's `node_modules`, so the API SBOM has them without a lookup.

**cdxgen is locked, not just pinned.** `npx cdxgen@<version>` pins cdxgen itself, but its ~150 dependencies resolve fresh on every run. So this repo installs cdxgen from `pnpm-lock.yaml` through the private [`packages/sbom-tools`](packages/sbom-tools/package.json) workspace package, and the web deploy passes that binary to the action as `cdxgen-bin`. No app depends on `packages/sbom-tools`, so `turbo prune` keeps it out of the Docker images. `sbom-source.yml` still uses `npx` because it runs without a `pnpm install`, with read-only permissions, and ships nothing.

**How `prod` mode works:** cdxgen reads the whole lockfile, then [`prune-bom.mjs`](.github/actions/sbom-lockfile/prune-bom.mjs) walks cdxgen's dependency graph starting from the `dependencies` (and `optionalDependencies`) in the project's `package.json`. Anything not reachable from there is dropped. The result matches what `pnpm deploy --prod` would install. We don't use cdxgen's own `--required-only` flag: for pnpm lockfiles it marks every transitive dependency as optional, so it drops them all (you get `express` but not `body-parser`).

### Never blocks a deploy

The artifact SBOM and scan steps use `continue-on-error: true`. If Syft, cdxgen, Grype or the upload fails, the step shows a warning and the deploy carries on. The deploy scans also run with `fail-on: none` (report only) and after the deploy step, so they never delay it. The source SBOM workflow isn't a required check (see [promoting the check to required](#promoting-the-scan-to-a-required-check)).

### Toggles

Repo variables (Settings > Secrets and variables > Actions > Variables). No YAML edits needed.

| Variable                  | Default    | Effect                                                                                                                                |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `SBOM_ARTIFACT_ENABLED`   | on         | Set to `false` to skip the SBOM step in both deploy workflows.                                                                        |
| `SBOM_SOURCE_ENABLED`     | on         | Set to `false` to skip `sbom-source.yml`.                                                                                             |
| `SBOM_ACR_ATTACH_ENABLED` | on         | Set to `false` to stop attaching the API SBOM to its image in ACR as an OCI referrer (`oras attach`).                                 |
| `GRYPE_FAIL_ON`           | `critical` | Lowest severity that fails the PR **Vulnerability scan**: `negligible`, `low`, `medium`, `high`, `critical`, or `none` (report only). |

"On by default" means the step runs unless the variable is exactly `false`, so a repo with no variables set gets SBOMs.

`SBOM_ACR_ATTACH_ENABLED` uses the same OIDC identity the deploy already uses. It needs push rights on the registry (the `AcrPush` role from `infra/template/github_actions_identity.tf` covers it).

### Where to find an SBOM

Every SBOM is uploaded as a GitHub Actions artifact on its workflow run (Actions tab > the run > Artifacts). Names:

- `sbom-api-<environment>-<commit sha>`
- `sbom-web-<environment>-<commit sha>`
- `sbom-source-<commit sha>`

Each run's job summary also shows the component count for each SBOM. Artifacts follow the repo's retention setting (90 days by default). The API SBOM also lives in ACR next to its image, so it doesn't expire. The web SBOM has no copy outside the artifact yet, so download it within the retention window if you need to keep it (see Azure Blob retention under future extensions).

### Running locally

Needs Node and a `pnpm install` (for the locked cdxgen in `packages/sbom-tools`). cdxgen only reads the lockfile:

```bash
# Writes sbom/source.cdx.json (full lockfile) and sbom/web.cdx.json (web prod deps).
# Takes a couple of minutes, most of it looking up licenses.
pnpm sbom

# Tests for the SBOM and scan actions
pnpm test:sbom
```

`pnpm sbom` runs the same script the composite action runs, so a local SBOM matches CI for the same commit. The `sbom/` folder is git-ignored.

For the API image SBOM, build the image and scan it with [Syft](https://github.com/anchore/syft) (same version as the `syft-version` default in the action):

```bash
docker build --target production -t api:local -f apps/api/Dockerfile .
syft scan api:local --output cyclonedx-json@1.6=sbom/api.cdx.json
```

### Vulnerability scanning and license warnings

Every SBOM is scanned with [Grype](https://github.com/anchore/grype) by the [`sbom-scan`](.github/actions/sbom-scan/action.yml) action:

| Where                                     | Scans                                        | Fails?                                                                    |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `sbom-source.yml`, job Vulnerability scan | Source SBOM, on every PR and daily on `main` | Yes, on fixable vulnerabilities at or above `GRYPE_FAIL_ON` (`critical`). |
| `deploy-api.yml`, `fe-web-deployment.yml` | The artifact SBOM                            | Never. Results go to the job summary.                                     |

**Fixable only:** the PR check only fails on vulnerabilities that have a fixed version (the same rule as `grype --only-fixed`). A CVE with no fix can't be solved by upgrading, so it never blocks. It still shows in the summary.

#### Reading the results

Open the workflow run and scroll to the job summary. Each scan adds:

- **Vulnerability scan:** a count per severity (found and fixable), how many are suppressed, and the threshold. When the check fails, a **blocking** table lists what failed it: advisory link, package, installed version and the version that fixes it. "All findings" (collapsed) lists everything, most severe first.
- **Flagged licenses:** packages under a copyleft license (GPL, AGPL, LGPL, SSPL) or the Business Source License (BUSL, source-available with production-use limits), with the full license text. Packages with no license data are listed by name (collapsed) so they can be checked by hand. Warning only, it never fails. Whether a flagged license is a problem depends on the client contract, so blocking stays a per-project decision. A package listed as `MIT OR GPL-2.0` can be used under MIT. `BSL-1.0` (the permissive Boost license) is not flagged.

Blocking vulnerabilities and flagged-license packages also show as annotations on the run.

The source scan also runs daily on `main` (and on demand from the Actions tab). A new advisory for a package already on `main` shows up there first, instead of failing every open PR at once.

To fix a blocking finding, upgrade the package to the "Fixed in" version. For a transitive dependency, upgrade the parent that pulls it in, or add a [`pnpm.overrides`](https://pnpm.io/package_json#pnpmoverrides) entry.

To reproduce locally, with [Grype](https://github.com/anchore/grype) installed (same version as the `grype-version` default in the action):

```bash
pnpm sbom
grype sbom:sbom/source.cdx.json --config .grype.yaml
```

#### Suppressing a vulnerability

When a finding doesn't apply (say, the vulnerable code only runs in a dev script), add it to [`.grype.yaml`](.grype.yaml):

```yaml
ignore:
  - vulnerability: GHSA-xxxx-xxxx-xxxx # or a CVE ID. Use the ID Grype reports.
    package:
      name: some-package
      version: 1.2.3 # optional, leave out to cover every version
    state: not_affected # CycloneDX analysis.state
    justification: code_not_reachable # required when state is not_affected
    reason: Only used by a dev script, never ships.
    expires: "2026-12-15"
```

Required fields: `vulnerability`, `package.name`, `state`, `reason` and `expires` (`YYYY-MM-DD`), plus `justification` when `state` is `not_affected`. The scan checks every entry first, and fails if a field is missing, `expires` has passed, or `expires` is more than 90 days out (the action's `max-expiry-days` input). That forces a re-review: when an entry expires, check again, then remove it or push the date out with an updated reason.

Pick `state` from the CycloneDX values:

| `state`          | Use when                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `not_affected`   | The vulnerable code can't be hit here. Needs a `justification`, e.g. `code_not_reachable`. |
| `exploitable`    | It does apply, and the risk is accepted for now (e.g. upstream has no fix yet).            |
| `false_positive` | Grype matched the wrong package or version.                                                |
| `in_triage`      | Still being looked at. Keep the expiry short.                                              |

`justification` values: `code_not_present`, `code_not_reachable`, `requires_configuration`, `requires_dependency`, `requires_environment`, `protected_by_compiler`, `protected_at_runtime`, `protected_at_perimeter`, `protected_by_mitigating_control`.

Grype reads `vulnerability`, `package` and `reason`. It ignores `state`, `justification` and `expires`, which only our check reads.

In the deploy scans (report only), suppression problems show as warnings instead.

**Mapping to CycloneDX VEX:** each entry maps 1:1 to a VEX statement, so the file can be converted to a VEX document later:

| `.grype.yaml`                      | CycloneDX VEX                                        |
| ---------------------------------- | ---------------------------------------------------- |
| `vulnerability`                    | `vulnerabilities[].id`                               |
| `package.name` + `package.version` | `vulnerabilities[].affects[].ref` (the package purl) |
| `state`                            | `vulnerabilities[].analysis.state`                   |
| `justification`                    | `vulnerabilities[].analysis.justification`           |
| `reason`                           | `vulnerabilities[].analysis.detail`                  |
| `expires`                          | `vulnerabilities[].properties` (name `expires`)      |

#### Changing the threshold

Set the repo variable `GRYPE_FAIL_ON` (Settings > Secrets and variables > Actions > Variables) to `negligible`, `low`, `medium`, `high` or `critical`. Everything at that severity and above fails the check. `none` makes the PR scan report only. Without the variable, the threshold is `critical`.

#### Promoting the scan to a required check

The PR scan ships as a non-required check, so it can prove it's quiet first. Once it has run for a while without false alarms (same approach as `typecheck.yml`):

1. Settings > Branches (or Rules > Rulesets) > the rule for `main`.
2. Under "Require status checks to pass", add **Vulnerability scan**.
3. Save. PRs with a blocking vulnerability can no longer merge.

A skipped scan (for example with `SBOM_SOURCE_ENABLED` set to `false`) counts as passing.

### Porting to an existing repo

1. Copy `.github/actions/sbom-image/`, `.github/actions/sbom-lockfile/` and `.github/actions/sbom-scan/` into the repo, plus `.grype.yaml`. They don't depend on anything else here.
2. In the API deploy workflow, after the image is pushed, add:

   ```yaml
   - name: Generate image SBOM
     if: vars.SBOM_ARTIFACT_ENABLED != 'false'
     continue-on-error: true
     uses: ./.github/actions/sbom-image
     with:
       image: <registry>/<image>:${{ github.sha }}
       name: api-<environment>-${{ github.sha }}
       attach-to-registry: ${{ vars.SBOM_ACR_ATTACH_ENABLED != 'false' }}
   ```

3. In the web deploy workflow, after the build, add the `sbom-lockfile` action with `mode: prod` and `workspace: <path to the web app>` (leave `workspace` empty in a single-package repo). Put it after the deploy step, so nothing it runs can change the build output before upload. The runner needs Node. To lock cdxgen's dependencies too, add `@cyclonedx/cdxgen` at an exact version to a package no app depends on, and pass its binary as `cdxgen-bin`.
4. After each SBOM step, add a report-only scan. Give the SBOM step an `id: sbom`, then:

   ```yaml
   - name: Scan SBOM
     if: ${{ !cancelled() && steps.sbom.outcome == 'success' }}
     continue-on-error: true
     uses: ./.github/actions/sbom-scan
     with:
       sbom-file: ${{ steps.sbom.outputs.sbom-file }}
       name: api-<environment>
       fail-on: none
   ```

5. Copy `.github/workflows/sbom-source.yml` for the source SBOM and the PR scan.
6. Optional: add the `sbom` and `test:sbom` scripts to the root `package.json`, and `/sbom/` to `.gitignore`.
7. Copy this file and update the artifact names and paths.

Works with npm, pnpm and Yarn lockfiles (cdxgen reads all three).

### Future extensions (not built)

- **cosign keyless attestation to ACR:** sign the SBOM and store the attestation next to the image, so a client can verify it came from our pipeline. Note: keyless signing writes the repo identity (org, repo, workflow) to the public Sigstore transparency log. Check that's fine for the client first.
- **GitHub artifact attestations** (`actions/attest-sbom`) aren't available on the org's current GitHub Team plan for private repos.
- **Dependency-Track upload:** push each SBOM to a Dependency-Track server for ongoing vulnerability tracking across releases.
- **Azure Blob retention:** copy SBOMs to a storage account when you need to keep them longer than the Actions artifact retention.
- **VEX documents:** convert `.grype.yaml` to a CycloneDX VEX file (see the mapping above) and publish it next to each SBOM, so clients see which findings we reviewed and why.
- **License gating:** fail the build on copyleft licenses, per project, when a client contract forbids them. The license report already has the data.
- **Dependency-Track:** see the upload item above. It also tracks new CVEs against past releases, which a per-PR scan can't.

---

## For client IT teams

_This section is written to be sent on its own._

### What you get

For every deployment of the application, we produce a Software Bill of Materials (SBOM): a machine-readable list of every third-party package in what we deployed, with versions, package URLs (purls) and licenses where known.

- **Format:** [CycloneDX](https://cyclonedx.org/) 1.6, JSON (`.cdx.json`). Most SCA and vulnerability tools read it directly (Dependency-Track, Grype, OWASP tools, most commercial scanners).
- **API (backend):** one SBOM per deployed Docker image. It covers the Node.js packages and the operating system packages of the base image.
- **Web (frontend):** one SBOM per deployment, listing the production JavaScript dependencies the web app declares, and everything they pull in, as locked in the project's lockfile. It is built from the lockfile, not from the built site files.
- Each SBOM is tied to one exact source commit (the commit SHA is in the file name) and one environment.
- We also scan each deployed SBOM for known vulnerabilities (with Grype) and for copyleft licenses. Ask your contact for the scan report of a given deploy.
- **How long we keep them:** API SBOMs are stored in the container registry next to their image, for as long as the image exists. Web SBOMs are kept for as long as our GitHub Actions artifact retention setting allows (90 days by default, but it can be set shorter). If you need a web SBOM for longer, ask for it soon after the deploy and keep your own copy.

### Artifact vs source SBOM

- The **artifact SBOM** is what's deployed in your environment. This is the one you want.
- The **source SBOM** is an internal build-time list that also includes developer tools that never ship (test runners, linters). Ask for it if your review covers the build pipeline, not only the running system.

### How to get an SBOM

**Option 1: from us.** Ask your contact for the SBOM of a given environment and deploy. We download it from the deploy run in GitHub Actions (artifact `sbom-api-<environment>-<commit sha>` or `sbom-web-<environment>-<commit sha>`).

**Option 2: straight from the container registry (API only).** The SBOM is attached to the image in Azure Container Registry as an OCI referrer. With [oras](https://oras.land/) and pull access to the registry:

```bash
az acr login --name <registry name>

# List SBOMs attached to an image
oras discover <registry name>.azurecr.io/api:<commit sha> \
  --artifact-type application/vnd.cyclonedx+json

# Download one (use the digest from the command above)
oras pull <registry name>.azurecr.io/api@<sbom digest> -o ./sbom
```

The SBOM is attached to the image digest, so it stays with that exact image even if tags move.
