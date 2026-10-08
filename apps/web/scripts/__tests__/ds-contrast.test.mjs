// @vitest-environment node
// design-system-kit 0.4.1 · profile shadcn · harness: ds-contrast tests
import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseColour, ratio, check } from "../ds-contrast.mjs"
import { repo, goodConfig } from "./helpers.mjs"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../ds-contrast.mjs")
const r = (a, b) => ratio(parseColour(a), parseColour(b))

const tokens = (colour) => ({
  name: "Probe",
  color: {
    themes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }],
    tokens: [
      { name: "grey-50", value: "#767676", usage: "Primitive." },
      { name: "grey-60", value: "#949494", usage: "Primitive." },
      { name: "white", value: "#ffffff", usage: "Primitive." },
      { name: "black", value: "#000000", usage: "Primitive." },
      { name: "background-normal", value: { light: "{white}", dark: "{black}" }, usage: "" },
      { name: "label-alternative", value: { light: "{grey-50}", dark: "{grey-60}" }, usage: "" },
      { name: "label-disable", value: { light: "#c8c8c8", dark: "#333333" }, usage: "" },
      { name: "chart-1", value: { light: "#000000", dark: "#ffffff" }, usage: "" },
      { name: "chart-2", value: { light: "#eeeeee", dark: "#ffffff" }, usage: "" },
      { name: "scrim", value: { light: "rgb(0 0 0 / 0.5)", dark: "rgb(0 0 0 / 0.5)" }, usage: "" },
      ...colour,
    ],
  },
})
const pairs = (list) => ({ pairs: list })

describe("ds-contrast: colour maths", () => {
  it("matches WCAG reference ratios", () => {
    expect(r("#ffffff", "#000000")).toBeCloseTo(21, 5)
    expect(r("#767676", "#ffffff")).toBeCloseTo(4.54, 2)
    expect(r("rgb(118, 118, 118)", "#fff")).toBeCloseTo(4.54, 2)
    expect(r("hsl(0 0% 100%)", "#000")).toBeCloseTo(21, 5)
    expect(r("oklch(1 0 0)", "#000")).toBeCloseTo(21, 2)
  })

  it("can't read named colours or var()", () => {
    expect(parseColour("red")).toBeNull()
    expect(parseColour("var(--x)")).toBeNull()
  })
})

describe("ds-contrast: pairs", () => {
  it("resolves aliases per theme and reports both themes", () => {
    const { rows } = check(tokens([]), pairs([{ foreground: "label-alternative", background: "background-normal", min: 4.5 }]))
    expect(rows[0].ratios.light).toBeCloseTo(4.54, 2)
    expect(rows[0].ratios.dark).toBeGreaterThan(4.5)
    expect(rows[0].status).toBe("pass")
  })

  it("expands a trailing * and fails a pair below its minimum", () => {
    const { rows } = check(tokens([]), pairs([{ foreground: "chart-*", background: "background-normal", min: 3 }]))
    expect(rows.map((x) => [x.foreground, x.status])).toEqual([["chart-1", "pass"], ["chart-2", "fail"]])
  })

  it("lets the config mark a pair intentional, with its reason", () => {
    const { rows } = check(
      tokens([]),
      pairs([{ foreground: "label-disable", background: "background-normal", min: 4.5 }]),
      [{ foreground: "label-disable", reason: "disabled" }]
    )
    expect(rows[0]).toMatchObject({ status: "intentional", reason: "disabled" })
  })

  it("composites a translucent foreground over its background", () => {
    const { rows } = check(tokens([]), pairs([{ foreground: "scrim", background: "background-normal", min: 1 }]))
    expect(rows[0].ratios.light).toBeCloseTo(r("#808080", "#ffffff"), 1)
    expect(rows[0].ratios.dark).toBeCloseTo(1, 5)
  })

  it("reports a pair naming a missing token as an error", () => {
    const { rows } = check(tokens([]), pairs([{ foreground: "on-nothing", background: "background-normal", min: 4.5 }]))
    expect(rows[0].status).toBe("error")
  })
})

describe("ds-contrast: CLI", () => {
  const run = (config, list) => {
    const dir = repo({ config, tokens: tokens([]), files: { "pairs.json": JSON.stringify(pairs(list)) } })
    return spawnSync(process.execPath, [SCRIPT, "--repo", dir, "--pairs", join(dir, "pairs.json")], { encoding: "utf8" })
  }

  it("prints every pair with its ratio and exits 0 when all pass or are intentional", () => {
    const out = run(goodConfig(), [
      { foreground: "label-alternative", background: "background-normal", min: 4.5 },
      { foreground: "label-disable", background: "background-normal", min: 4.5 },
    ])
    expect(out.status).toBe(0)
    expect(out.stdout).toMatch(/\| `label-alternative` \| `background-normal` \| 4\.5 \| 4\.54:1 \|/)
    expect(out.stdout).toMatch(/intentional \(disabled\)/)
  })

  it("exits 1 on a miss the config doesn't excuse", () => {
    const config = { ...goodConfig(), contrast: { intentional: [] } }
    const out = run(config, [{ foreground: "label-disable", background: "background-normal", min: 4.5 }])
    expect(out.status).toBe(1)
    expect(out.stdout).toMatch(/\*\*FAIL\*\*/)
  })
})
