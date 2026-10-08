// @vitest-environment node
// design-system-kit 0.4.1 · profile shadcn · harness: ds-validate tests
import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { validate, validateTemplate, isDateFormat, isLocale, compareVersions, KIT_VERSION, rampOf, hueIn, listedInSystem, installedVersion, detectFramework } from "../ds-validate.mjs"
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { repo, goodConfig, snapshot } from "./helpers.mjs"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../ds-validate.mjs")
const fields = (r) => r.errors.map((e) => e.field)

describe("ds-validate: config", () => {
  it("passes a complete, valid repo", () => {
    expect(validate(repo()).errors).toEqual([])
  })

  it("names every missing required key", () => {
    const config = goodConfig()
    delete config.designSystem
    delete config.namespace
    expect(fields(validate(repo({ config })))).toEqual(expect.arrayContaining(["designSystem", "namespace"]))
  })

  it("rejects unknown keys, with the known ones in the fix", () => {
    const r = validate(repo({ config: { ...goodConfig(), tokenz: "x" } }))
    expect(fields(r)).toContain("tokenz")
    expect(r.errors.find((e) => e.field === "tokenz").fix).toMatch(/tokensIn/)
  })

  it("checks settings: BCP 47 locale, week start 0–6, date format", () => {
    const config = goodConfig()
    config.settings = { locale: "english", weekStartsOn: 7, dateFormat: "DD/DD/YYYY" }
    expect(fields(validate(repo({ config })))).toEqual(
      expect.arrayContaining(["settings.locale", "settings.weekStartsOn", "settings.dateFormat"])
    )
  })

  it("rejects a typeClassPrefix without a trailing dash and a lowercase namespace", () => {
    const config = { ...goodConfig(), typeClassPrefix: "type", namespace: "probe" }
    expect(fields(validate(repo({ config })))).toEqual(expect.arrayContaining(["typeClassPrefix", "namespace"]))
  })

  it("flags a componentFiles entry that names no file", () => {
    const config = { ...goodConfig(), componentFiles: { Button: ["buton.tsx"] } }
    expect(fields(validate(repo({ config })))).toContain("componentFiles.Button")
  })

  it("refuses a kitVersion newer than the scripts, and only warns on an older one", () => {
    expect(fields(validate(repo({ config: { ...goodConfig(), kitVersion: "9.0.0" } })))).toContain("kitVersion")
    const older = validate(repo({ config: { ...goodConfig(), kitVersion: "0.0.1" } }))
    expect(older.errors).toEqual([])
    expect(older.warnings.map((w) => w.field)).toContain("kitVersion")
  })
})

describe("ds-validate: token snapshot", () => {
  const withColour = (extra, mutate = () => {}) => {
    const t = snapshot()
    t.color.tokens.push(...extra)
    mutate(t)
    return validate(repo({ tokens: t }))
  }

  it("rejects bad names, unknown aliases, named colours and self-aliases", () => {
    const r = withColour([
      { name: "bad name", value: "#000", usage: "" },
      { name: "points-nowhere", value: { light: "{missing}", dark: "#000" }, usage: "" },
      { name: "named", value: { light: "red", dark: "#000" }, usage: "" },
      { name: "selfish", value: { light: "{selfish}", dark: "#000" }, usage: "" },
    ])
    const text = r.errors.map((e) => `${e.field} ${e.message}`).join("\n")
    expect(text).toMatch(/bad name/)
    expect(text).toMatch(/points-nowhere.*\{missing\}/)
    expect(text).toMatch(/named.*"red"/)
    expect(text).toMatch(/selfish.*itself/)
  })

  it("finds an alias cycle", () => {
    const r = withColour([
      { name: "a", value: { light: "{b}", dark: "#000" }, usage: "" },
      { name: "b", value: { light: "{a}", dark: "#000" }, usage: "" },
    ])
    expect(r.errors.some((e) => /cycle: (a → b → a|b → a → b)/.test(e.message))).toBe(true)
  })

  it("names each semantic token the mapping needs but the snapshot lacks", () => {
    const r = withColour([], (t) => { t.color.tokens = t.color.tokens.filter((x) => x.name !== "on-accent") })
    expect(r.errors.some((e) => e.field.endsWith("on-accent") && /mapping needs it/.test(e.message))).toBe(true)
  })

  it("rejects a duplicate name across families", () => {
    const t = snapshot()
    t.radius.tokens.push({ name: "space-1", value: "4px", usage: "" })
    expect(validate(repo({ tokens: t })).errors.some((e) => /appears in both/.test(e.message))).toBe(true)
  })
})

describe("ds-validate: client-added ramps", () => {
  const ramp = (name) => Array.from({ length: 3 }, (_, i) => ({ name: `${name}-${(i + 1) * 10}`, value: "#7744aa", usage: `Primitive ${name} step ${(i + 1) * 10}.` }))
  const withRamp = (name, opts = {}) => {
    const t = snapshot()
    t.color.tokens.push(...ramp(name))
    const dir = repo({ tokens: t, files: opts.system ? { "system.md": opts.system } : {} })
    return validate(dir, { system: opts.system ? join(dir, "system.md") : undefined })
  }
  const SYSTEM = "# System\n\n**Probe-specific choices**\n- A `data` ramp for chart colours the brand roles can't supply.\n\n**Open deviations** — none.\n"

  it("accepts a role-named ramp and, without --system, only notes it", () => {
    const r = withRamp("data")
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.notes.join()).toMatch(/client-added ramps data/)
  })

  it("warns when the System section doesn't list it, and not when it does", () => {
    expect(withRamp("data", { system: SYSTEM }).warnings).toEqual([])
    const r = withRamp("data", { system: SYSTEM.replace("`data`", "plum") })
    expect(r.warnings.map((w) => w.field)).toEqual([".ttt/tokens.json › data-*"])
  })

  it("rejects a ramp named by hue", () => {
    const r = withRamp("plum")
    expect(r.errors.some((e) => e.field.endsWith("plum-*") && /named by hue \("plum"\)/.test(e.message))).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it("reads ramps, hues and the System section's list", () => {
    expect([rampOf("data-50"), rampOf("neutral-0"), rampOf("brand-primary-95"), rampOf("ink")]).toEqual(["data", "neutral", "brand-primary", "ink"])
    expect([hueIn("data"), hueIn("brand-teal"), hueIn("neutral")]).toEqual([null, "teal", null])
    expect([...listedInSystem(SYSTEM)]).toEqual(["data"])
    expect([...listedInSystem("# System\n\nno choices block")]).toEqual([])
  })
})

describe("ds-validate: wiring", () => {
  it("requires @source and checks it resolves to the source root", () => {
    expect(fields(validate(repo({ css: '@import "tailwindcss";\n' })))).toContain("src/app/globals.css › @source")
    const wrong = validate(repo({ css: '@import "tailwindcss";\n@source "../../";\n' }))
    const e = wrong.errors.find((x) => x.field.endsWith("@source"))
    expect(e.message).toMatch(/not the source root src/)
    expect(e.fix).toMatch(/"\.\.\/"/)
  })
})

describe("ds-validate: pre-flight", () => {
  it("compares the lockfile against the tested range", () => {
    const lock = { packages: { "node_modules/next": { version: "14.2.0" }, "node_modules/react": { version: "19.1.0" } } }
    const range = { packages: { next: { min: "15.5.0", max: "15.5.27" }, react: { min: "19.1.0", max: "19.3.0" } } }
    const dir = repo({ files: { "package-lock.json": JSON.stringify(lock), "range.json": JSON.stringify(range) } })
    const r = validate(dir, { preflight: true, testedRange: join(dir, "range.json") })
    expect(fields(r)).toEqual(["package next"])
    expect(r.errors[0].message).toMatch(/14\.2\.0, outside the tested range 15\.5\.0 – 15\.5\.27/)
  })
})

describe("ds-validate: token file header", () => {
  it("warns when the token file's Snapshot synced line isn't lastSynced", () => {
    const header = (t) => `/*\n * Snapshot synced: ${t}\n */\n:root {}\n`
    expect(validate(repo({ files: { "src/styles/ds-tokens.css": header("2026-10-07T18:00:00Z") } })).warnings).toEqual([])
    const r = validate(repo({ files: { "src/styles/ds-tokens.css": header("2026-10-07T17:00:00Z") } }))
    expect(r.errors).toEqual([])
    expect(r.warnings.map((w) => w.field)).toEqual(["src/styles/ds-tokens.css"])
    expect(r.warnings[0].fix).toMatch(/set lastSynced before regenerating/)
  })
})

describe("ds-validate: frameworks and workspaces", () => {
  const range = { packages: { react: { min: "19.1.0", max: "19.3.0", required: true } },
    frameworks: { next: { next: { min: "15.5.27", max: "15.5.27", required: true } }, vite: { vite: { min: "7.3.1", max: "7.3.1", required: true }, eslint: { min: "10.0.3", max: "10.0.3" } } } }
  const pkg = (dir, name, version) => { mkdirSync(join(dir, "node_modules", name), { recursive: true }); writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, version })) }
  const workspace = (appDeps) => {
    const root = mkdtempSync(join(tmpdir(), "ds-ws-"))
    const app = join(root, "apps/web")
    mkdirSync(app, { recursive: true })
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
    writeFileSync(join(app, "package.json"), JSON.stringify({ dependencies: appDeps }))
    writeFileSync(join(root, "range.json"), JSON.stringify(range))
    return { root, app }
  }

  it("reads versions from an app's node_modules and from the workspace root above it", () => {
    const { root, app } = workspace({ vite: "^7" })
    pkg(app, "react", "19.2.4")
    pkg(root, "eslint", "10.0.3")
    expect([installedVersion(app, "react"), installedVersion(app, "eslint"), installedVersion(app, "next")]).toEqual(["19.2.4", "10.0.3", null])
  })

  it("prefers the app's own entry in a workspace package-lock", () => {
    const { root, app } = workspace({ vite: "^7" })
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/react": { version: "19.1.0" }, "apps/web/node_modules/react": { version: "19.3.0" } } }))
    expect(installedVersion(app, "react")).toBe("19.3.0")
  })

  it("detects the framework and checks that framework's range before a config exists", () => {
    const { root, app } = workspace({ vite: "^7" })
    expect(detectFramework(app)).toBe("vite")
    pkg(app, "react", "19.2.4"); pkg(app, "vite", "7.3.1"); pkg(root, "eslint", "9.39.5")
    const r = validate(app, { preflight: true, testedRange: join(root, "range.json") })
    expect(fields(r)).toEqual([".ttt/design-system.json", "package eslint"])
    expect(r.errors[1].message).toMatch(/9\.39\.5, outside the tested range 10\.0\.3/)
  })

  it("blocks an app that depends on neither or both frameworks", () => {
    const { root, app } = workspace({ next: "15", vite: "7" })
    expect(detectFramework(app)).toBe(null)
    expect(fields(validate(app, { preflight: true, testedRange: join(root, "range.json") }))).toContain("framework")
  })

  it("accepts framework next or vite in the config, and nothing else", () => {
    expect(validate(repo({ config: { ...goodConfig(), framework: "vite" } })).errors).toEqual([])
    expect(fields(validate(repo({ config: { ...goodConfig(), framework: "remix" } })))).toContain("framework")
  })
})

describe("ds-validate: pre-flight before Setup", () => {
  it("checks the lockfile even when there's no config yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-preflight-"))
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ packages: { "node_modules/tailwindcss": { version: "3.4.1" } } }))
    writeFileSync(join(dir, "range.json"), JSON.stringify({ packages: { tailwindcss: { min: "4.3.3", max: "4.3.3" } } }))
    const r = validate(dir, { preflight: true, testedRange: join(dir, "range.json") })
    expect(fields(r)).toEqual([".ttt/design-system.json", "package tailwindcss"])
  })
})

describe("ds-validate: helpers and CLI", () => {
  it("knows date formats, locales and versions", () => {
    expect(["", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "D.M.YY"].every(isDateFormat)).toBe(true)
    expect(["DD/MM", "DD/MM-YYYY", "dd/mm/yyyy", "DDD/MM/YYYY"].some(isDateFormat)).toBe(false)
    expect(isLocale("en-US") && isLocale("fr-CA") && !isLocale("en_US") && !isLocale("english")).toBe(true)
    expect(compareVersions("0.1.1", "0.1.10")).toBe(-1)
    expect(KIT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("exits 1 and names the field when something is wrong", () => {
    const dir = repo({ config: { ...goodConfig(), settings: { locale: "en-US", weekStartsOn: 9, dateFormat: "" } } })
    const run = spawnSync(process.execPath, [SCRIPT, "--repo", dir], { encoding: "utf8" })
    expect(run.status).toBe(1)
    expect(run.stdout).toMatch(/error {4}settings\.weekStartsOn is 9 — a number 0–6/)
  })

  it("exits 0 on a valid repo", () => {
    expect(spawnSync(process.execPath, [SCRIPT, "--repo", repo()], { encoding: "utf8" }).status).toBe(0)
  })
})

describe("ds-validate: --template", () => {
  const write = (config, tokens = snapshot()) => {
    const dir = mkdtempSync(join(tmpdir(), "ds-template-test-"))
    writeFileSync(join(dir, "config.json"), JSON.stringify(config))
    writeFileSync(join(dir, "tokens.json"), JSON.stringify(tokens))
    return [join(dir, "config.json"), join(dir, "tokens.json")]
  }

  it("accepts {{…}} placeholders where Setup fills a value, and lists them", () => {
    const config = { ...goodConfig(), designSystem: "{{DESIGN_SYSTEM_URL}}", namespace: "{{CLIENT_NAMESPACE}}",
      settings: { locale: "{{LOCALE}}", weekStartsOn: "{{WEEK_STARTS_ON}}", dateFormat: "{{DATE_FORMAT}}" } }
    const r = validateTemplate(...write(config))
    expect(r.errors).toEqual([])
    expect(r.warnings[0].fix).toMatch(/\{\{LOCALE\}\}/)
  })

  it("still checks every non-placeholder value", () => {
    const r = validateTemplate(...write({ ...goodConfig(), typeClassPrefix: "type", settings: { locale: "{{LOCALE}}", weekStartsOn: 9, dateFormat: "" } }))
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["typeClassPrefix", "settings.weekStartsOn"]))
  })

  it("requires the template's kitVersion to match the scripts", () => {
    const r = validateTemplate(...write({ ...goodConfig(), kitVersion: "0.0.1" }))
    expect(r.errors.map((e) => e.field)).toContain("kitVersion")
  })
})

