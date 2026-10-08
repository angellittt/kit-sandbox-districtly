#!/usr/bin/env node
// design-system-kit 0.10.0 · profile shadcn · kit file — fix it in the kit, not per client
/**
 * ds-validate.mjs — the contract's config validation.
 *
 *   node scripts/ds-validate.mjs               # config, token snapshot, wiring
 *   node scripts/ds-validate.mjs --preflight   # …and installed versions vs the tested range
 *   node scripts/ds-validate.mjs --repo <dir>  # validate another checkout
 *   node scripts/ds-validate.mjs --system <01-system.md>
 *                                             # compare with a live copy of the System
 *                                             # section instead of the committed snapshot
 *                                             # (systemIn, normally .ttt/system.md):
 *                                             # client-added ramps are listed there, and
 *                                             # its Client settings line matches the app's
 *                                             # locale module. A difference is a "drift"
 *                                             # warning; scripts/__tests__/ds-drift.test.mjs
 *                                             # fails the repo's tests on one
 *   node scripts/ds-validate.mjs --template <config.json> --tokens <tokens.json>
 *                                             # the kit's own templates ("{{…}}" allowed)
 *
 * Checks `.ttt/design-system.json` against the schema below (every key), the
 * token snapshot it points at (name grammar, aliases, cycles, colour formats,
 * the semantic tokens the profile's mapping needs, primitive ramps named by
 * role, never by hue), that the theme block's
 * `@source` resolves to the source root, that the app's locale module
 * (`<aliases.lib>/locale.ts`: locale, week start, date format) holds valid
 * values, and that the repo's `kitVersion` is no newer than these scripts. Every error names the field and says how to
 * fix it. Exits 1 on any error; warnings don't fail.
 *
 * Runs at the start of every skill run, and in CI through the repo's tests
 * (ds-drift.test.mjs).
 */

import { readFileSync, existsSync } from "node:fs"
import { join, resolve, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

/** The kit these scripts belong to. A repo may not claim a newer one. */
export const KIT_VERSION = "0.10.0"
const SCHEMA = "ttt-ds/1"
const PROFILE = "shadcn"

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Profile: shadcn. The contract's token mapping table, in full.
// shadcn variable -> semantic token name.
// ---------------------------------------------------------------------------
export const SHADCN_MAP = {
  background: "background-normal",
  foreground: "label-normal",
  card: "background-elevated",
  "card-foreground": "label-normal",
  popover: "background-elevated",
  "popover-foreground": "label-normal",
  primary: "primary-normal",
  "primary-foreground": "on-primary",
  // shadcn's "secondary" and "accent" are NEUTRAL greys, not brand colours.
  // The brand ones are exposed under brand-* below.
  secondary: "fill-normal",
  "secondary-foreground": "label-normal",
  muted: "fill-alternative",
  "muted-foreground": "label-alternative",
  accent: "fill-alternative",
  "accent-foreground": "label-normal",
  destructive: "status-negative",
  border: "line-normal",
  input: "line-strong",
  ring: "focus-ring",
  sidebar: "background-alternative",
  "sidebar-foreground": "label-normal",
  "sidebar-primary": "primary-normal",
  "sidebar-primary-foreground": "on-primary",
  "sidebar-accent": "fill-normal",
  "sidebar-accent-foreground": "label-normal",
  "sidebar-border": "line-normal",
  "sidebar-ring": "focus-ring",
  "chart-1": "chart-1",
  "chart-2": "chart-2",
  "chart-3": "chart-3",
  "chart-4": "chart-4",
  "chart-5": "chart-5",
};

/**
 * Tailwind-only colour names from the mapping table: brand colours, which
 * shadcn's own names would otherwise shadow, the status shorthands, and the
 * inverse/scrim roles. A client whose brand fills share one foreground points
 * `on-secondary` / `on-accent` at it in the design system, not here.
 */
export const ALIAS_COLORS = {
  "brand-secondary": "secondary-normal",
  "brand-secondary-foreground": "on-secondary",
  "brand-secondary-soft": "secondary-soft",
  "brand-secondary-text": "secondary-text",
  "brand-accent": "accent-normal",
  "brand-accent-foreground": "on-accent",
  "brand-accent-soft": "accent-soft",
  "brand-accent-text": "accent-text",
  positive: "status-positive",
  "positive-soft": "status-positive-soft",
  cautionary: "status-cautionary",
  "cautionary-soft": "status-cautionary-soft",
  negative: "status-negative",
  "negative-soft": "status-negative-soft",
  inverse: "inverse-background",
  "inverse-foreground": "inverse-label",
  dimmer: "material-dimmer",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** tsconfig/components.json allow comments; strip them without eating strings. */
function readJsonc(path) {
  const src = readFileSync(path, "utf8")
  let out = "", inStr = false, quote = "", i = 0
  while (i < src.length) {
    const c = src[i], next = src[i + 1]
    if (inStr) {
      out += c
      if (c === "\\") { out += next ?? ""; i += 2; continue }
      if (c === quote) inStr = false
      i++
      continue
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; i++; continue }
    if (c === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue }
    if (c === "/" && next === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue }
    out += c
    i++
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

const semver = (v) => /^(\d+)\.(\d+)\.(\d+)/.exec(String(v))?.slice(1).map(Number)
/** -1, 0 or 1; null if either side isn't a version. */
export function compareVersions(a, b) {
  const x = semver(a), y = semver(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v)
const isUrl = (v) => {
  try { return ["https:", "http:"].includes(new URL(v).protocol) } catch { return false }
}

/** A token name the design system type accepts. */
export const TOKEN_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const ALIAS = /^\{([^}]+)\}$/
/** Colour forms the design system type reads (no nested functions, no named colours). */
const COLOUR = [
  /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^()]*\)$/i,
]
export const isColour = (v) => COLOUR.some((re) => re.test(String(v).trim()))
const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|%)?$/

/** The contract's standard primitive ramps. A client may add more, named by role. */
export const STANDARD_RAMPS = ["brand-primary", "brand-secondary", "brand-accent", "neutral", "positive", "cautionary", "negative"]
/** Words that name a hue, not a role. A ramp name containing one is rejected. */
const HUE_WORDS = new Set(("red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple " +
  "fuchsia pink rose magenta plum lavender lilac mauve maroon crimson scarlet tomato coral salmon peach " +
  "gold golden mustard olive mint navy aqua turquoise brown tan beige cream ivory grey gray slate zinc " +
  "stone charcoal black white silver ruby sapphire jade cobalt ochre sand").split(" "))
/** "data-50" → "data"; "neutral-0" → "neutral"; a primitive with no step is its own ramp. */
export const rampOf = (name) => name.replace(/-\d+(\.\d+)?$/, "")
/** A primitive is a colour token whose usage text starts with "Primitive" (contract, Token tiers). */
const isPrimitive = (t) => /^Primitive/.test(t?.usage ?? "")
/** The hue word in a ramp name, if any. */
export const hueIn = (ramp) => ramp.split(/[-_.]/).find((w) => HUE_WORDS.has(w.toLowerCase())) ?? null

/**
 * The ramps the System section's client-specific choices name: every `code`
 * span in the "**…-specific choices**" block (up to the next bold heading).
 */
export function listedInSystem(markdown) {
  const m = /\*\*[^*\n]*-specific choices\*\*([\s\S]*?)(?=\n\*\*[^*\n]+\*\*|$)/.exec(markdown)
  return new Set([...(m?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((x) => x[1]))
}

/** "DD/MM/YYYY", "M.D.YY" … one day, one month, one year, one separator. */
export function isDateFormat(v) {
  if (v === "") return true
  const m = /^([DMY]+)([/.\- ])([DMY]+)\2([DMY]+)$/.exec(v)
  if (!m) return false
  const parts = [m[1], m[3], m[4]]
  const ok = { D: ["D", "DD"], M: ["M", "MM"], Y: ["YY", "YYYY"] }
  const seen = new Set()
  for (const p of parts) {
    const kind = p[0]
    if (!ok[kind]?.includes(p) || seen.has(kind)) return false
    seen.add(kind)
  }
  return seen.size === 3
}

/**
 * A canonical BCP 47 tag of the form apps actually use: an ISO 639 language
 * (2–3 letters), an optional script, an optional region ("en-US", "zh-Hant-TW",
 * "es-419"). `Intl` alone would accept "english", a reserved 5–8 letter subtag.
 */
export function isLocale(v) {
  if (typeof v !== "string" || !/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/.test(v)) return false
  try {
    return Intl.getCanonicalLocales(v)[0] === v
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// The config schema: every key, what it must be, how to fix it
// ---------------------------------------------------------------------------

const str = (fix) => (v) => typeof v === "string" && v.length > 0 ? null : fix
const CONFIG_SCHEMA = {
  designSystem: { required: true, check: (v) => isUrl(v) ? null : "set it to the design system's claude.ai link" },
  tracker: { required: true, check: (v) => isUrl(v) ? null : "set it to the project's ClickUp list URL" },
  schema: { required: true, check: (v) => v === SCHEMA ? null : `this kit reads schema "${SCHEMA}"; the design system and repo must agree` },
  profile: { required: true, check: (v) => v === PROFILE ? null : `these scripts are profile "${PROFILE}"; install the kit's code for "${v}" instead` },
  kitVersion: { required: true, check: (v) => semver(v) ? null : 'set it to the kit version the repo was set up or last synced with, e.g. "0.1.1"' },
  tokensIn: { required: true, check: str('set it to the token snapshot path, normally ".ttt/tokens.json"') },
  systemIn: { required: false, check: str('set it to the System section snapshot path, normally ".ttt/system.md"') },
  tokensOut: { required: true, check: (v) => typeof v === "string" && v.endsWith(".css") ? null : 'set it to the generated token file, e.g. "src/styles/ds-tokens.css"' },
  lastSynced: { required: true, check: (v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?Z$/.test(v) && !isNaN(Date.parse(v)) ? null : 'use an RFC 3339 UTC time from the system clock, e.g. "2026-10-07T18:01:26Z"' },
  typeClassPrefix: { required: true, check: (v) => typeof v === "string" && /^[a-z][a-z0-9-]*-$/.test(v) ? null : 'lowercase, ending in "-", e.g. "type-"' },
  namespace: { required: true, check: (v) => typeof v === "string" && /^[A-Z][A-Za-z0-9_$]*$/.test(v) ? null : 'a PascalCase JavaScript identifier for the bundle global, e.g. "Acme"' },
  bundleExtras: { required: false, check: (v) => isObject(v) && Object.values(v).every((a) => Array.isArray(a) && a.every((n) => typeof n === "string" && /^[A-Za-z_$][\w$]*$/.test(n))) ? null : 'map a module to the export names the bundle adds, e.g. {"sonner": ["toast"]}' },
  componentFiles: { required: false, check: (v) => isObject(v) && Object.entries(v).every(([k, a]) => /^[A-Z][A-Za-z0-9]*$/.test(k) && Array.isArray(a) && a.length && a.every((f) => typeof f === "string" && /^[a-z0-9-]+\.tsx$/.test(f))) ? null : 'map each PascalCase component to its .tsx files, e.g. {"Input": ["input.tsx", "label.tsx"]}' },
  framework: { required: false, check: (v) => v in FRAMEWORKS ? null : `one of ${Object.keys(FRAMEWORKS).map((f) => `"${f}"`).join(", ")}; leave it out for "next"` },
  contrast: { required: false, check: (v) => isObject(v) ? null : 'an object: { "intentional": [{ "foreground", "background"?, "reason" }] }' },
  usingInCode: { required: false, check: (v) => isObject(v) ? null : 'an object: { "notes": ["…"] }' },
}

/** The app's locale module: what each value must be, how to fix it. */
const LOCALE_SCHEMA = {
  localeTag: (v) => isLocale(v) ? null : 'a canonical BCP 47 tag, e.g. "en-US" or "fr-CA"',
  weekStartsOn: (v) => Number.isInteger(v) && v >= 0 && v <= 6 ? null : "a number 0–6, 0 = Sunday; always stated, never derived from the locale",
  dateFormat: (v) => typeof v === "string" && isDateFormat(v) ? null : '"" to use the locale\'s pattern, or one day, month and year with one separator, e.g. "DD/MM/YYYY"',
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/**
 * The values the app's locale module states, read from its source:
 * `export const localeTag = "en-CA"`, `export const weekStartsOn = 1`,
 * `export const dateFormat = "YYYY-MM-DD"`, `export const locale = enCA`.
 * A value that isn't a plain literal reads as undefined.
 */
export function readLocaleModule(source) {
  const lit = (name, re) => { const m = new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*${re}`).exec(source); return m ? m[1] : undefined }
  const week = lit("weekStartsOn", "(\\d+)")
  return {
    localeTag: lit("localeTag", '"([^"]*)"'),
    weekStartsOn: week === undefined ? undefined : Number(week),
    dateFormat: lit("dateFormat", '"([^"]*)"'),
    locale: lit("locale", "([A-Za-z_$][\\w$]*)"),
    imports: new Set([...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']date-fns\/locale["']/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean))),
  }
}

/** The System section's Client settings line: locale, week start, date format. */
export function readSystemSettings(markdown) {
  const line = /\*\*Client settings\*\*([^\n]*)/.exec(markdown)?.[1]
  if (!line) return null
  const locale = /locale `([^`]+)`/.exec(line)?.[1]
  const day = /week starts (?:on )?(\w+)/.exec(line)?.[1]
  const format = /date format `([^`]*)`/.exec(line)?.[1]
  return { localeTag: locale, weekStartsOn: day ? DAYS.indexOf(day[0].toUpperCase() + day.slice(1).toLowerCase()) : undefined, dateFormat: format }
}

// ---------------------------------------------------------------------------

/** A Setup placeholder such as "{{LOCALE}}" — legal only in the kit's config template. */
const isPlaceholder = (v) => typeof v === "string" && /^\{\{[A-Z_]+\}\}$/.test(v)

/** Every key of the config against the schema. `placeholders` accepts "{{…}}" values. */
function checkConfig(config, err, { placeholders = false } = {}) {
  for (const [key, rule] of Object.entries(CONFIG_SCHEMA)) {
    if (!(key in config)) {
      if (rule.required) err(key, "is missing", rule.check(undefined) ?? "add it")
      continue
    }
    if (placeholders && isPlaceholder(config[key])) continue
    const problem = rule.check(config[key])
    if (problem) err(key, `is ${JSON.stringify(config[key])}`, problem)
  }
  for (const key of Object.keys(config)) {
    if (key === "settings") continue // moved to the app's locale module in kit 0.5.0; validate() warns
    if (!(key in CONFIG_SCHEMA)) err(key, "isn't a key this kit knows", `remove it, or check its spelling against: ${Object.keys(CONFIG_SCHEMA).join(", ")}`)
  }
  if (isObject(config.contrast)) {
    const list = config.contrast.intentional ?? []
    if (!Array.isArray(list)) err("contrast.intentional", "isn't a list", "a list of { foreground, background?, reason }")
    else list.forEach((x, i) => {
      if (!isObject(x) || typeof x.foreground !== "string" || typeof x.reason !== "string" || !x.reason.trim())
        err(`contrast.intentional[${i}]`, `is ${JSON.stringify(x)}`, 'give a foreground token and a reason, e.g. { "foreground": "label-disable", "reason": "…" }')
    })
    for (const key of Object.keys(config.contrast)) if (key !== "intentional") err(`contrast.${key}`, "isn't a key this kit knows", 'the only key is "intentional"')
  }
  if (isObject(config.usingInCode)) {
    const notes = config.usingInCode.notes ?? []
    if (!Array.isArray(notes) || !notes.every((n) => typeof n === "string"))
      err("usingInCode.notes", "isn't a list of strings", "one Markdown paragraph per entry")
    for (const key of Object.keys(config.usingInCode)) if (key !== "notes") err(`usingInCode.${key}`, "isn't a key this kit knows", 'the only key is "notes"')
  }
}

export function validate(repo, { preflight = false, testedRange, system } = {}) {
  const errors = []
  const warnings = []
  const notes = []
  const err = (field, message, fix) => errors.push({ field, message, fix })
  // kind "drift": code and the design system's System section disagree.
  const warn = (field, message, fix, kind) => warnings.push({ field, message, fix, ...(kind && { kind }) })

  // ---- config --------------------------------------------------------------
  const configPath = join(repo, ".ttt/design-system.json")
  if (!existsSync(configPath)) {
    err(".ttt/design-system.json", "not found", "this repo isn't connected to a design system; Setup writes it")
    // Setup's pre-flight runs before the config exists: the lockfile check still applies.
    if (preflight) checkTestedRange(repo, testedRange, err)
    return { errors, warnings, notes }
  }
  let config
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"))
  } catch (e) {
    err(".ttt/design-system.json", `isn't valid JSON (${e.message})`, "fix the syntax")
    return { errors, warnings, notes }
  }

  checkConfig(config, err)
  if ("settings" in config)
    warn("settings", "is in .ttt/design-system.json; since kit 0.5.0 locale, week start and date format live in the app's locale module", "copy the values into <aliases.lib>/locale.ts (wiring/locale.ts) and remove settings from the config")

  // ---- kit version -----------------------------------------------------------
  if (semver(config.kitVersion)) {
    const cmp = compareVersions(config.kitVersion, KIT_VERSION)
    if (cmp > 0) err("kitVersion", `is ${config.kitVersion}, newer than these scripts (${KIT_VERSION})`, `copy the kit ${config.kitVersion} scripts into scripts/, or install that kit version`)
    else if (cmp < 0) warn("kitVersion", `is ${config.kitVersion}; these scripts are ${KIT_VERSION}`, `set it to ${KIT_VERSION} once the rest of the kit's files are synced`)
  }
  // Every kit script in the repo should name the same kit version.
  for (const name of ["ds-tokens", "ds-pack-react", "ds-build-bundle", "ds-styling-maps", "ds-types", "ds-validate", "ds-contrast"]) {
    const p = join(repo, "scripts", `${name}.mjs`)
    if (!existsSync(p)) continue
    const v = /design-system-kit (\d+\.\d+\.\d+)/.exec(readFileSync(p, "utf8").slice(0, 400))?.[1]
    if (!v) warn(`scripts/${name}.mjs`, "doesn't name a kit version", "copy it from the kit unchanged")
    else if (v !== KIT_VERSION) warn(`scripts/${name}.mjs`, `is kit ${v}; ds-validate is ${KIT_VERSION}`, "copy all kit scripts from one kit version")
  }

  // ---- System section snapshot -------------------------------------------------
  // The design system's 01-system.md, committed beside the token snapshot so the
  // drift checks run in CI. --system (a live copy) wins over it.
  if (!system && typeof config.systemIn === "string") {
    const p = join(repo, config.systemIn)
    if (existsSync(p)) system = p
    else warn("systemIn", `points at ${config.systemIn}, which doesn't exist`, "run Sync's pull to write the snapshot (Setup writes the first one)")
  }

  // ---- token snapshot ----------------------------------------------------------
  if (typeof config.tokensIn === "string") {
    const tokensPath = join(repo, config.tokensIn)
    if (!existsSync(tokensPath)) err("tokensIn", `points at ${config.tokensIn}, which doesn't exist`, "run Sync's pull to write the snapshot")
    else {
      let tokens
      try { tokens = JSON.parse(readFileSync(tokensPath, "utf8")) }
      catch (e) { err(config.tokensIn, `isn't valid JSON (${e.message})`, "re-pull it from the design system") }
      if (tokens) {
        validateTokens(tokens, config.tokensIn, err, warn)
        checkClientRamps(tokens, config.tokensIn, system, warn, notes)
      }
    }
  }

  // ---- the token file was generated from this snapshot -------------------------
  if (typeof config.tokensOut === "string" && existsSync(join(repo, config.tokensOut))) {
    const synced = /Snapshot synced: (\S+)/.exec(readFileSync(join(repo, config.tokensOut), "utf8").slice(0, 600))?.[1]
    if (synced && config.lastSynced && synced !== config.lastSynced)
      warn(config.tokensOut, `says "Snapshot synced: ${synced}" but lastSynced is ${config.lastSynced}`, "regenerate it with node scripts/ds-tokens.mjs (set lastSynced before regenerating)")
  }

  // ---- wiring: @source resolves to the source root -------------------------------
  checkSource(repo, err, warn)
  checkLocale(repo, system, err, warn, notes)

  // ---- componentFiles name real files --------------------------------------------
  const ui = uiDir(repo)
  if (ui && isObject(config.componentFiles)) {
    for (const [comp, files] of Object.entries(config.componentFiles)) {
      if (!Array.isArray(files)) continue
      for (const f of files) if (typeof f === "string" && !existsSync(join(ui, f)))
        err(`componentFiles.${comp}`, `lists ${f}, which isn't in ${relative(repo, ui)}`, "fix the file name or remove the entry")
    }
  }

  // ---- pre-flight: installed versions vs the tested range --------------------------
  if (preflight) checkTestedRange(repo, testedRange, err, config.framework ?? "next")

  return { errors, warnings, notes }
}

function validateTokens(tokens, file, err, warn) {
  const where = (name) => `${file} › ${name}`
  if (!isObject(tokens.color) || !Array.isArray(tokens.color.tokens)) {
    err(`${file} › color`, "has no tokens list", 'families are { "tokens": [{ "name", "value", "usage" }] } lists, not name → value maps')
    return
  }
  const themes = (tokens.color.themes ?? []).map((t) => t?.id)
  if (!themes.length || themes.some((t) => typeof t !== "string")) err(`${file} › color.themes`, "declares no theme ids", 'list themes as [{ "id": "light", "name": "Light" }, …]')

  // Names: grammar and uniqueness across every family but type.
  const all = new Map()
  for (const [family, group] of Object.entries(tokens)) {
    if (family === "type" || !isObject(group) || !Array.isArray(group.tokens)) continue
    for (const t of group.tokens) {
      if (!TOKEN_NAME.test(t?.name ?? "")) { err(where(t?.name ?? "(unnamed)"), `in ${family} isn't a valid token name`, "start with a letter or digit; then letters, digits, _ . - (no spaces or /), at most 64 characters"); continue }
      if (all.has(t.name)) err(where(t.name), `appears in both ${all.get(t.name)} and ${family}`, "rename one; a duplicate is dropped by the design system")
      else all.set(t.name, family)
    }
  }

  // Colours: per-theme values, alias targets, formats.
  const colours = new Map(tokens.color.tokens.filter((t) => TOKEN_NAME.test(t?.name ?? "")).map((t) => [t.name, t]))
  const valuesOf = (t) => (isObject(t.value) ? t.value : { [themes[0]]: t.value })
  for (const t of colours.values()) {
    if (t.value == null) { err(where(t.name), "has no value", "give it a colour or an {alias}"); continue }
    if (isObject(t.value)) for (const k of Object.keys(t.value)) if (!themes.includes(k)) err(where(t.name), `has a value for theme "${k}", which color.themes doesn't declare`, `use one of: ${themes.join(", ")}`)
    for (const [theme, v] of Object.entries(valuesOf(t))) {
      const m = ALIAS.exec(String(v).trim())
      if (m) {
        if (!colours.has(m[1])) err(where(t.name), `(${theme}) aliases {${m[1]}}, which isn't a colour token`, "point it at an existing colour token or use a literal")
        else if (m[1] === t.name) err(where(t.name), `(${theme}) aliases itself`, "point it at a primitive")
      } else if (!isColour(v)) {
        err(where(t.name), `(${theme}) is ${JSON.stringify(v)}, not a colour the design system reads`, "use hex, rgb(), hsl() or oklch() with no function inside; no named colours, var() or color-mix()")
      }
    }
  }
  // Cycles, per theme.
  for (const theme of themes) {
    const next = (name) => {
      const t = colours.get(name)
      if (!t) return null
      const v = valuesOf(t)[theme] ?? valuesOf(t)[themes[0]]
      return ALIAS.exec(String(v ?? "").trim())?.[1] ?? null
    }
    const reported = new Set()
    for (const start of colours.keys()) {
      const path = [start]
      let cur = next(start)
      while (cur && colours.has(cur)) {
        if (path.includes(cur)) {
          const cycle = path.slice(path.indexOf(cur)).concat(cur)
          const key = [...cycle].sort().join()
          if (!reported.has(key)) {
            reported.add(key)
            err(where(cur), `(${theme}) is in an alias cycle: ${cycle.join(" → ")}`, "break the cycle by pointing one of them at a primitive")
          }
          break
        }
        path.push(cur)
        cur = next(cur)
      }
    }
  }

  // Primitive ramps: named by role, never by hue.
  const ramps = new Set([...colours.values()].filter(isPrimitive).map((t) => rampOf(t.name)))
  for (const ramp of ramps) {
    const hue = hueIn(ramp)
    if (hue) err(where(`${ramp}-*`), `is a ramp named by hue ("${hue}")`, `name it by the role it plays (e.g. "data" for chart colours), in the design system, then re-pull; standard ramps are ${STANDARD_RAMPS.join(", ")}`)
  }

  // The semantic tokens the profile's mapping needs.
  const required = new Set([...Object.values(SHADCN_MAP), ...Object.values(ALIAS_COLORS)])
  for (const name of required) if (!colours.has(name))
    err(where(name), "is missing; the profile's token mapping needs it", "add it in the design system (a semantic token aliasing a primitive), then re-pull")

  // Scalars.
  for (const family of ["spacing", "radius"]) {
    for (const t of tokens[family]?.tokens ?? []) if (!LENGTH.test(String(t.value).trim()))
      err(where(t.name), `is ${JSON.stringify(t.value)}, not a length`, "use px, rem, em, % or a plain number")
  }
  if (!(tokens.spacing?.tokens ?? []).some((t) => t.name === "space-1"))
    warn(`${file} › space-1`, "is missing", "Tailwind's spacing base is set from space-1; without it utilities use Tailwind's default 0.25rem")
  for (const g of tokens.type?.groups ?? []) {
    if (!(g.family in (tokens.type.families ?? {}))) err(`${file} › type.groups.${g.name}`, `uses family "${g.family}", which type.families doesn't define`, "add the family or fix the name")
    for (const s of g.styles ?? []) if (!LENGTH.test(String(s.fontSize ?? "")))
      err(`${file} › type.${s.name}`, `has fontSize ${JSON.stringify(s.fontSize)}`, "use a length such as 15px")
  }
}

/**
 * Client-added ramps (any primitive ramp beyond the standard roles) must be
 * recorded in the System section's client-specific choices. With `system`
 * (a copy of the design system's 01-system.md) each one not named there is a
 * warning; without it the check can't run and says so as a note.
 */
function checkClientRamps(tokens, file, system, warn, notes) {
  const prims = (tokens.color?.tokens ?? []).filter((t) => TOKEN_NAME.test(t?.name ?? "") && isPrimitive(t))
  const added = [...new Set(prims.map((t) => rampOf(t.name)))].filter((r) => !STANDARD_RAMPS.includes(r) && !hueIn(r))
  if (!added.length) return
  if (!system) {
    notes.push(`client-added ramps ${added.join(", ")} — not checked against the System section (set systemIn, or pass --system <01-system.md>)`)
    return
  }
  if (!existsSync(system)) { warn("--system", `points at ${system}, which doesn't exist`, "save the design system's project/01-system.md and pass its path"); return }
  const listed = listedInSystem(readFileSync(system, "utf8"))
  for (const ramp of added) if (!listed.has(ramp))
    warn(`${file} › ${ramp}-*`, "is a client-added ramp the System section doesn't list", `add it to the System section's client-specific choices, e.g. "A \`${ramp}\` ramp for …"`, "drift")
}

/**
 * The app's locale module (`<aliases.lib>/locale.ts`): app-owned since kit
 * 0.5.0 — Setup seeds it, devs edit it. Its values must be valid; with
 * `--system`, they are compared with the System section's Client settings
 * line, where design records the same decision. A difference is a warning:
 * one side is out of date, and a person decides which.
 */
function checkLocale(repo, system, err, warn, notes) {
  const cj = join(repo, "components.json")
  if (!existsSync(cj) || !existsSync(join(repo, "tsconfig.json"))) return
  const lib = resolveAlias(repo, readJsonc(cj).aliases?.lib ?? "@/lib")
  if (!lib) { warn("components.json › aliases.lib", "doesn't resolve through tsconfig paths", "add the \"@/*\" path so the locale module can be found"); return }
  const path = join(lib, "locale.ts")
  const rel = relative(repo, path)
  if (!existsSync(path)) { err(rel, "not found", "copy the kit's wiring/locale.ts there and set the client's locale, week start and date format (Setup does this)"); return }
  const mod = readLocaleModule(readFileSync(path, "utf8"))
  for (const [k, check] of Object.entries(LOCALE_SCHEMA)) {
    if (mod[k] === undefined) { err(`${rel} › ${k}`, "isn't exported as a plain literal", `export const ${k} = …, so tools can read it`); continue }
    const problem = check(mod[k])
    if (problem) err(`${rel} › ${k}`, `is ${JSON.stringify(mod[k])}`, problem)
  }
  if (!mod.locale) err(`${rel} › locale`, "isn't exported", "export the date-fns locale, e.g. export const locale: Locale = enCA")
  else if (!mod.imports.has(mod.locale)) err(`${rel} › locale`, `is ${mod.locale}, which isn't imported from date-fns/locale`, `import { ${mod.locale} } from "date-fns/locale"`)
  else if (isLocale(mod.localeTag ?? "") && mod.locale !== mod.localeTag.replace(/-/g, ""))
    warn(`${rel} › locale`, `is ${mod.locale}, but localeTag is ${mod.localeTag}`, `use date-fns's locale for ${mod.localeTag} (usually ${mod.localeTag.replace(/-/g, "")}), or the closest one it ships`)
  if (!system) { notes.push(`${rel} not compared with the System section's Client settings (set systemIn, or pass --system <01-system.md>)`); return }
  if (!existsSync(system)) { warn("--system", `points at ${system}, which doesn't exist`, "save the design system's project/01-system.md and pass its path"); return }
  const sys = readSystemSettings(readFileSync(system, "utf8"))
  if (!sys) { warn("System section", "has no Client settings line", "add one: **Client settings** — locale `…` · week starts … · date format `…`.", "drift"); return }
  const show = (k, v) => k === "weekStartsOn" ? (DAYS[v] ?? String(v)) : JSON.stringify(v)
  for (const k of Object.keys(LOCALE_SCHEMA))
    if (sys[k] !== undefined && mod[k] !== undefined && sys[k] !== mod[k])
      warn(`${rel} › ${k}`, `is ${show(k, mod[k])}; the System section records ${show(k, sys[k])}`, "design records the decision and code holds it: fix whichever is wrong — code in a PR, or the design system's System section and then Sync's pull to refresh the snapshot", "drift")
}

function uiDir(repo) {
  const cj = join(repo, "components.json"), tc = join(repo, "tsconfig.json")
  if (!existsSync(cj) || !existsSync(tc)) return null
  const alias = readJsonc(cj).aliases?.ui ?? "@/components/ui"
  return resolveAlias(repo, alias)
}

function resolveAlias(repo, spec) {
  const paths = readJsonc(join(repo, "tsconfig.json")).compilerOptions?.paths ?? {}
  for (const [pattern, targets] of Object.entries(paths)) {
    const prefix = pattern.replace(/\*$/, "")
    if (!spec.startsWith(prefix)) continue
    const target = String(targets[0]).replace(/\*$/, "")
    return resolve(repo, target + spec.slice(prefix.length))
  }
  return null
}

/** The source root: where tsconfig's "@/*" (the first wildcard path) points. */
export function sourceRoot(repo) {
  const tc = join(repo, "tsconfig.json")
  if (!existsSync(tc)) return null
  const paths = readJsonc(tc).compilerOptions?.paths ?? {}
  const first = Object.entries(paths).find(([p]) => p.endsWith("/*"))
  if (!first) return null
  return resolve(repo, String(first[1][0]).replace(/\/?\*$/, ""))
}

function checkSource(repo, err, warn) {
  const cj = join(repo, "components.json")
  if (!existsSync(cj)) { err("components.json", "not found", "run `shadcn init`"); return }
  const cssRel = readJsonc(cj).tailwind?.css
  if (!cssRel) { err("components.json › tailwind.css", "is missing", "set it to the global CSS path"); return }
  const cssPath = join(repo, cssRel)
  if (!existsSync(cssPath)) { err("components.json › tailwind.css", `points at ${cssRel}, which doesn't exist`, "fix the path"); return }
  const root = sourceRoot(repo)
  if (!root) { warn("tsconfig.json › paths", "has no wildcard alias", "add \"@/*\" so the source root can be checked"); return }
  const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  const sources = [...css.matchAll(/@source\s+(?!not\b)["']([^"']+)["']/g)].map((m) => m[1])
  const want = relative(dirname(cssPath), root) || "."
  if (!sources.length) {
    err(`${cssRel} › @source`, "is missing", `add \`@source "${want.startsWith(".") ? want : "./" + want}";\` — the theme block declares the scan root explicitly`)
    return
  }
  const hits = sources.filter((s) => resolve(dirname(cssPath), s) === root)
  if (!hits.length) {
    err(`${cssRel} › @source`, `resolves to ${sources.map((s) => relative(repo, resolve(dirname(cssPath), s)) || ".").join(", ")}, not the source root ${relative(repo, root) || "."}`, `set it to "${want.endsWith("/") ? want : want + "/"}" (relative to ${cssRel})`)
  }
}

/**
 * The version of a package as the app sees it, for any package manager and
 * for an app inside a workspace (e.g. `apps/web` in a pnpm monorepo):
 *
 * 1. an npm `package-lock.json` in the app's folder or any folder above it —
 *    the app's own entry first (`apps/web/node_modules/x` in a workspace
 *    lock), then the hoisted one (`node_modules/x`);
 * 2. otherwise the installed package itself, found the way Node resolves it:
 *    `node_modules/<name>/package.json` in the app's folder, then each
 *    folder above it (pnpm's symlinks, Yarn without Plug'n'Play, devDeps
 *    hoisted to the workspace root).
 *
 * null when it isn't installed anywhere the app can reach.
 */
export function installedVersion(app, name) {
  const root = resolve(app)
  for (let dir = root; ; dir = dirname(dir)) {
    const lock = join(dir, "package-lock.json")
    if (existsSync(lock)) {
      const pkgs = JSON.parse(readFileSync(lock, "utf8")).packages ?? {}
      const rel = relative(dir, root).split("\\").join("/")
      const v = (rel && pkgs[`${rel}/node_modules/${name}`]?.version) || pkgs[`node_modules/${name}`]?.version
      if (v) return v
      break
    }
    if (dirname(dir) === dir) break
  }
  for (let dir = root; ; dir = dirname(dir)) {
    const pkg = join(dir, "node_modules", name, "package.json")
    if (existsSync(pkg)) return JSON.parse(readFileSync(pkg, "utf8")).version ?? null
    if (dirname(dir) === dir) return null
  }
}

/** The frameworks this profile supports, and the package that marks each. */
export const FRAMEWORKS = { next: "next", vite: "vite" }

/** The app's framework from its own package.json (pre-flight runs before there's a config). */
export function detectFramework(app) {
  const p = join(app, "package.json")
  if (!existsSync(p)) return null
  const pkg = JSON.parse(readFileSync(p, "utf8"))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const found = Object.entries(FRAMEWORKS).filter(([, marker]) => marker in deps).map(([name]) => name)
  return found.length === 1 ? found[0] : null
}

function checkTestedRange(repo, testedRange, err, framework) {
  const rangePath = testedRange ?? join(HERE, "tested-range.json")
  if (!existsSync(rangePath)) { err("tested-range.json", "not found next to the scripts", "copy it from the kit with the scripts"); return }
  const range = JSON.parse(readFileSync(rangePath, "utf8"))
  let packages = range.packages
  if (range.frameworks) {
    const fw = framework ?? detectFramework(repo)
    if (!fw || !range.frameworks[fw]) {
      err("framework", fw ? `is "${fw}", which this kit has no tested range for` : "can't be told from the app's package.json",
        `this profile supports ${Object.keys(range.frameworks).join(" and ")} — the app's package.json must depend on exactly one of ${Object.values(FRAMEWORKS).join(", ")}`)
      return
    }
    packages = { ...range.packages, ...range.frameworks[fw] }
  }
  for (const [name, { min, max, required }] of Object.entries(packages)) {
    const v = installedVersion(repo, name)
    if (!v) {
      if (required) err(`package ${name}`, "isn't installed", `install ${name}@${max}`)
      continue
    }
    if (compareVersions(v, min) < 0 || compareVersions(v, max) > 0)
      err(`package ${name}`, `is ${v}, outside the tested range ${min} – ${max}`, "flag it for the dev; Setup never upgrades or downgrades an existing package")
  }
}

/**
 * The kit's own config template and token template (`--template`): every key
 * is checked as in a repo, except that a "{{…}}" placeholder stands for a value
 * Setup fills; `kitVersion` must equal these scripts' version; and there is no
 * repo, so the wiring and pre-flight checks don't apply.
 */
export function validateTemplate(configPath, tokensPath) {
  const errors = []
  const warnings = []
  const err = (field, message, fix) => errors.push({ field, message, fix })
  const warn = (field, message, fix) => warnings.push({ field, message, fix })
  let config
  try { config = JSON.parse(readFileSync(configPath, "utf8")) }
  catch (e) { err(configPath, `can't be read (${e.message})`, "fix the file"); return { errors, warnings } }
  checkConfig(config, err, { placeholders: true })
  if (config.kitVersion !== KIT_VERSION)
    err("kitVersion", `is ${config.kitVersion} in the config template; these scripts are ${KIT_VERSION}`, "bump the template with the scripts")
  const filled = [JSON.stringify(config).match(/\{\{[A-Z_]+\}\}/g) ?? []].flat()
  if (filled.length) warnings.push({ field: "placeholders", message: `${filled.length} left for Setup to fill`, fix: [...new Set(filled)].join(" ") })
  let tokens
  try { tokens = JSON.parse(readFileSync(tokensPath, "utf8")) }
  catch (e) { err(tokensPath, `can't be read (${e.message})`, "fix the file"); return { errors, warnings } }
  validateTokens(tokens, tokensPath, err, warn)
  return { errors, warnings }
}

// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2)
  const flag = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1] }
  const repo = resolve(flag("--repo") ?? process.cwd())
  const { errors, warnings, notes } = args.includes("--template")
    ? validateTemplate(resolve(flag("--template")), resolve(flag("--tokens")))
    : validate(repo, { preflight: args.includes("--preflight"), testedRange: flag("--tested-range"), system: flag("--system") && resolve(flag("--system")) })
  for (const n of notes ?? []) console.log(`note     ${n}`)
  for (const w of warnings) console.log(`warning  ${w.field} ${w.message} — ${w.fix}`)
  for (const e of errors) console.log(`error    ${e.field} ${e.message} — ${e.fix}`)
  console.log(errors.length ? `\n${errors.length} error(s), ${warnings.length} warning(s)` : `valid (${warnings.length} warning(s)) — kit ${KIT_VERSION}`)
  process.exit(errors.length ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
