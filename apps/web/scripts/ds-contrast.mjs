#!/usr/bin/env node
// design-system-kit 0.4.1 · profile shadcn · kit file — fix it in the kit, not per client
/**
 * ds-contrast.mjs — check every contrast requirement in every theme.
 *
 *   node scripts/ds-contrast.mjs                 # the snapshot in .ttt/design-system.json
 *   node scripts/ds-contrast.mjs --tokens <file> # another snapshot (e.g. a design system's tokens.json)
 *   node scripts/ds-contrast.mjs --pairs <file>  # another pairs file
 *   node scripts/ds-contrast.mjs --repo <dir>
 *   node scripts/ds-contrast.mjs --config <file> # read contrast.intentional from another config (the kit's template)
 *
 * Pairs come from scripts/contrast-pairs.json, written against semantic token
 * names so the same file serves every client. Each colour is resolved through
 * its aliases per theme; a translucent foreground is composited over its
 * background, and a translucent background over background-normal. Prints
 * every pair with its ratio in each theme, and exits 1 on any miss except
 * those the repo config lists under `contrast.intentional` (with a reason).
 *
 * Setup and every token change run it.
 */

import { readFileSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ALIAS = /^\{([^}]+)\}$/

// ---------------------------------------------------------------------------
// Colour parsing → linear-light sRGB with alpha
// ---------------------------------------------------------------------------

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function num(s, scale = 1) {
  s = s.trim()
  if (s === "none") return 0
  if (s.endsWith("%")) return (parseFloat(s) / 100) * scale
  return parseFloat(s)
}
function hue(s) {
  s = s.trim()
  const v = parseFloat(s)
  if (s.endsWith("turn")) return v * 360
  if (s.endsWith("rad")) return (v * 180) / Math.PI
  if (s.endsWith("grad")) return v * 0.9
  return v
}
function args(inner) {
  const [main, alpha] = inner.split("/")
  const parts = main.replace(/,/g, " ").trim().split(/\s+/)
  if (alpha === undefined && parts.length === 4) return { parts: parts.slice(0, 3), alpha: num(parts[3], 1) }
  return { parts, alpha: alpha === undefined ? 1 : num(alpha, 1) }
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)]
}

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function labToLinear(L, a, b) {
  // CIE Lab (D50) → XYZ → linear sRGB (Bradford-adapted to D65).
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200
  const e = 216 / 24389, k = 24389 / 27
  const xr = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k
  const yr = L > k * e ? fy ** 3 : L / k
  const zr = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k
  const [X, Y, Z] = [xr * 0.96422, yr, zr * 0.82521]
  return [
    3.1341359569958707 * X - 1.6173863321612538 * Y - 0.4906619460083532 * Z,
    -0.978795502912089 * X + 1.916254567259524 * Y + 0.03344273116131949 * Z,
    0.07195537988411677 * X - 0.2289768264158322 * Y + 1.405386058324125 * Z,
  ]
}

/** A colour string → { rgb: linear [r,g,b], a } or null when it can't be read. */
export function parseColour(value) {
  const v = String(value).trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
    if (h.length !== 6 && h.length !== 8) return null
    const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    return { rgb: n.map(toLinear), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 }
  }
  m = /^([a-z]+)\((.*)\)$/.exec(v)
  if (!m) return null
  const [, fn, inner] = m
  const { parts, alpha } = args(inner)
  const a = clamp(alpha)
  switch (fn) {
    case "rgb": case "rgba":
      return { rgb: parts.map((p) => toLinear(clamp(num(p, 255) / 255))), a }
    case "hsl": case "hsla":
      return { rgb: hslToRgb(hue(parts[0]), clamp(num(parts[1], 1)), clamp(num(parts[2], 1))).map((c) => toLinear(clamp(c))), a }
    case "hwb": {
      const [w, bl] = [clamp(num(parts[1], 1)), clamp(num(parts[2], 1))]
      const base = hslToRgb(hue(parts[0]), 1, 0.5)
      const sum = w + bl
      const rgb = sum >= 1 ? [w / sum, w / sum, w / sum] : base.map((c) => c * (1 - w - bl) + w)
      return { rgb: rgb.map((c) => toLinear(clamp(c))), a }
    }
    case "oklab":
      return { rgb: oklabToLinear(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4)).map((c) => clamp(c)), a }
    case "oklch": {
      const [L, C, H] = [num(parts[0], 1), num(parts[1], 0.4), (hue(parts[2]) * Math.PI) / 180]
      return { rgb: oklabToLinear(L, C * Math.cos(H), C * Math.sin(H)).map((c) => clamp(c)), a }
    }
    case "lab":
      return { rgb: labToLinear(num(parts[0], 100), num(parts[1], 125), num(parts[2], 125)).map((c) => clamp(c)), a }
    case "lch": {
      const [L, C, H] = [num(parts[0], 100), num(parts[1], 150), (hue(parts[2]) * Math.PI) / 180]
      return { rgb: labToLinear(L, C * Math.cos(H), C * Math.sin(H)).map((c) => clamp(c)), a }
    }
    case "color": {
      const [space, ...rest] = parts
      if (space === "srgb") return { rgb: rest.map((p) => toLinear(clamp(num(p, 1)))), a }
      if (space === "srgb-linear") return { rgb: rest.map((p) => clamp(num(p, 1))), a }
      return null
    }
  }
  return null
}

/** Composite a translucent colour over an opaque one, in gamma space as browsers do. */
function over(top, bottom) {
  if (top.a >= 1) return top
  const mix = top.rgb.map((c, i) => toLinear(toGamma(c) * top.a + toGamma(bottom.rgb[i]) * (1 - top.a)))
  return { rgb: mix, a: 1 }
}

const luminance = ({ rgb }) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
export function ratio(fg, bg) {
  const [x, y] = [luminance(fg), luminance(bg)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

export function resolver(tokens) {
  const themes = (tokens.color?.themes ?? []).map((t) => t.id)
  const byName = new Map((tokens.color?.tokens ?? []).map((t) => [t.name, t]))
  /** The literal colour a token has in a theme, following aliases. */
  function literal(name, theme, seen = new Set()) {
    const t = byName.get(name)
    if (!t) throw new Error(`token "${name}" isn't in the snapshot`)
    if (seen.has(name)) throw new Error(`alias cycle through "${name}" — run ds-validate`)
    seen.add(name)
    const raw = t.value && typeof t.value === "object" ? t.value[theme] ?? t.value[themes[0]] : t.value
    const m = ALIAS.exec(String(raw).trim())
    return m ? literal(m[1], theme, seen) : String(raw).trim()
  }
  function colour(name, theme) {
    const lit = literal(name, theme)
    const c = parseColour(lit)
    if (!c) throw new Error(`"${name}" is ${lit} in ${theme}, which this script can't read`)
    return c
  }
  return { themes, has: (n) => byName.has(n), names: [...byName.keys()], colour }
}

function expand(spec, names) {
  const list = Array.isArray(spec) ? spec : [spec]
  return list.flatMap((s) => (s.endsWith("*") ? names.filter((n) => n.startsWith(s.slice(0, -1))) : [s]))
}

/** Every pair, every theme → rows. */
export function check(tokens, pairsFile, intentional = []) {
  const r = resolver(tokens)
  const rows = []
  for (const p of pairsFile.pairs) {
    for (const fg of expand(p.foreground, r.names)) {
      for (const bg of expand(p.background, r.names)) {
        const row = { foreground: fg, background: bg, min: p.min, why: p.why, ratios: {}, problems: [] }
        if (!r.has(fg) || !r.has(bg)) {
          row.problems.push(`${!r.has(fg) ? fg : bg} isn't in the snapshot`)
        } else {
          for (const theme of r.themes) {
            try {
              let b = r.colour(bg, theme)
              if (b.a < 1 && r.has("background-normal")) b = over(b, r.colour("background-normal", theme))
              const f = over(r.colour(fg, theme), b)
              row.ratios[theme] = ratio(f, b)
            } catch (e) {
              row.problems.push(`${theme}: ${e.message}`)
            }
          }
        }
        const fails = Object.values(row.ratios).some((x) => x + 1e-9 < p.min)
        const allowed = intentional.find((x) => x.foreground === fg && (!x.background || x.background === bg))
        row.status = row.problems.length ? "error" : fails ? (allowed ? "intentional" : "fail") : "pass"
        if (allowed) row.reason = allowed.reason
        rows.push(row)
      }
    }
  }
  return { themes: r.themes, rows }
}

export function table({ themes, rows }) {
  const head = `| Foreground | Background | Min | ${themes.map((t) => t[0].toUpperCase() + t.slice(1)).join(" | ")} | Result |`
  const sep = `|---|---|---|${themes.map(() => "---|").join("")}---|`
  const body = rows.map((r) => {
    const cells = themes.map((t) => (r.ratios[t] == null ? "—" : `${r.ratios[t].toFixed(2)}:1`))
    const result = r.status === "pass" ? "pass" : r.status === "intentional" ? `below — intentional (${r.reason})` : r.status === "fail" ? "**FAIL**" : `**ERROR** ${r.problems.join("; ")}`
    return `| \`${r.foreground}\` | \`${r.background}\` | ${r.min} | ${cells.join(" | ")} | ${result} |`
  })
  return [head, sep, ...body].join("\n")
}

// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2)
  const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1] }
  const repo = resolve(flag("--repo") ?? join(HERE, ".."))
  const configPath = flag("--config") ? resolve(flag("--config")) : join(repo, ".ttt/design-system.json")
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {}
  const tokensPath = flag("--tokens") ? resolve(flag("--tokens")) : join(repo, config.tokensIn ?? ".ttt/tokens.json")
  const pairsPath = resolve(flag("--pairs") ?? join(HERE, "contrast-pairs.json"))
  const tokens = JSON.parse(readFileSync(tokensPath, "utf8"))
  const pairs = JSON.parse(readFileSync(pairsPath, "utf8"))
  const result = check(tokens, pairs, config.contrast?.intentional ?? [])
  console.log(table(result))
  const failed = result.rows.filter((r) => r.status === "fail" || r.status === "error")
  const intentional = result.rows.filter((r) => r.status === "intentional").length
  console.log(`\n${result.rows.length} pairs × ${result.themes.length} themes: ${failed.length} failing, ${intentional} intentional`)
  process.exit(failed.length ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
