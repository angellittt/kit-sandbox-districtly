// @vitest-environment node
// design-system-kit 0.10.0 · profile shadcn · wiring: the repo against its design system
//
// Setup puts this beside the one kit script a repo carries, scripts/ds-validate.mjs,
// so the repo's own test run (and so its CI) checks it.
//
// Runs ds-validate on this repo in its own test run, so CI catches what a
// person would otherwise only see by running ds:validate: config errors, and
// drift between code and the design system's System section (the committed
// snapshot, systemIn). Skipped where there's no repo config (the kit's own
// test run).
import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { validate } from "./ds-validate.mjs"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const connected = existsSync(join(REPO, ".ttt/design-system.json"))
const show = (list) => list.map((x) => `${x.field} ${x.message} — ${x.fix}`).join("\n")

describe.skipIf(!connected)("this repo and its design system", () => {
  const { errors, warnings } = validate(REPO)

  // Compared as text, so a failure prints each problem with its fix.
  it("validates", () => {
    expect(show(errors)).toBe("")
  })

  it("agrees with the System section", () => {
    expect(show(warnings.filter((w) => w.kind === "drift"))).toBe("")
  })
})
