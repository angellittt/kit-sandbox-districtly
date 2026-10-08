#!/usr/bin/env node
// design-system-kit 0.4.1 · profile shadcn · kit file — fix it in the kit, not per client
/**
 * ds-styling-maps.mjs — the styling map in every implemented component's
 * README, generated from that component's code.
 *
 * KIT FILE. Generic across repos on profile `shadcn` 1.2: the token names, the
 * UI directory and the component-to-file mapping all come from the consuming
 * repo's own config, never from anything hardcoded here.
 *
 *   node scripts/ds-styling-maps.mjs Button          # one component's table
 *   node scripts/ds-styling-maps.mjs --all           # every component
 *   node scripts/ds-styling-maps.mjs --used-by <tokens.json> [<out>]
 *                                    # rewrite each token's "Used by" list
 *   node scripts/ds-styling-maps.mjs --using-in-code [<out.md>]
 *                                    # the design system's "Using in code" section
 *
 * The contract fixes one format for every component:
 *
 *   | Part | State or variant | Attribute | Token |
 *
 * A value that cannot be traced to a token is listed as "fixed in code", so
 * the table stays a complete account of the component's styling rather than
 * only its tokenised half.
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const REPO = process.cwd()
const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require_ = createRequire(join(TOOL_ROOT, "package.json"))
const ts = require_("typescript")

// ---------------------------------------------------------------------------
// Repo configuration
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
  return JSON.parse(out)
}

const dsConfig = JSON.parse(
  readFileSync(join(REPO, ".ttt/design-system.json"), "utf8")
)
const componentsJson = JSON.parse(
  readFileSync(join(REPO, "components.json"), "utf8")
)
const tsconfig = readJsonc(join(REPO, "tsconfig.json"))

/** Resolve the `aliases.ui` path (e.g. "@/components/ui") through tsconfig paths. */
function uiDir() {
  const alias = componentsJson.aliases?.ui ?? "@/components/ui"
  const paths = tsconfig.compilerOptions?.paths ?? {}
  for (const [pattern, targets] of Object.entries(paths)) {
    const prefix = pattern.replace(/\*$/, "")
    if (alias.startsWith(prefix)) {
      const target = targets[0].replace(/\*$/, "")
      return join(REPO, target + alias.slice(prefix.length))
    }
  }
  return join(REPO, alias.replace(/^@\//, "src/"))
}

const UI = uiDir()
const tokens = JSON.parse(readFileSync(join(REPO, dsConfig.tokensIn), "utf8"))

/**
 * Components whose code spans more than one file, or whose file name is not
 * the kebab-case of the component name. Everything else is inferred.
 */
const EXTRA_FILES = dsConfig.componentFiles ?? {}

// ---------------------------------------------------------------------------
// Tokens: which names are semantic, and what each Tailwind utility resolves to
// ---------------------------------------------------------------------------

/** Semantic tokens only — primitives are never referenced by components. */
const SEMANTIC = new Set()
for (const [family, group] of Object.entries(tokens)) {
  if (!group?.tokens) continue
  for (const t of group.tokens) {
    // The tier is a naming convention; the usage text carries it.
    if (family === "color" && /^Primitive/.test(t.usage ?? "")) continue
    SEMANTIC.add(t.name)
  }
}

/**
 * The CSS variable graph from the generated token file, so `bg-primary`
 * resolves through `--color-primary` → `--primary` → `--primary-normal`
 * without this script having to restate the profile's mapping table.
 */
const cssVarAlias = new Map()
{
  const css = readFileSync(join(REPO, dsConfig.tokensOut), "utf8")
  // The light theme and @theme block are enough: an alias chain is the same in
  // both themes, only its leaf value differs.
  // Names may carry an escaped dot (`--space-0\.5`); store them unescaped.
  const unescape = (n) => n.replace(/\\\./g, ".")
  for (const m of css.matchAll(/--((?:[a-z0-9-]|\\\.)+):\s*var\(--((?:[a-z0-9-]|\\\.)+)\)/gi)) {
    const [k, v] = [unescape(m[1]), unescape(m[2])]
    if (!cssVarAlias.has(k)) cssVarAlias.set(k, v)
  }
}

/** Follow an alias chain to the first semantic token name, if any. */
function resolveVar(name, seen = new Set()) {
  let cur = name
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    if (SEMANTIC.has(cur)) return cur
    cur = cssVarAlias.get(cur) ?? cssVarAlias.get(`color-${cur}`)
  }
  return null
}

/** A Tailwind colour name (`card`, `label-alternative`) → its semantic token. */
function colorToken(name) {
  if (!name) return null
  // Strip an opacity modifier: `input/30` is still the `input` colour.
  const bare = name.split("/")[0]
  return resolveVar(bare) ?? resolveVar(`color-${bare}`)
}

/**
 * An arbitrary value like `[0_0_0_3px_var(--focus-ring)]` → its token.
 * A component-local custom property (Badge's `--t-solid`) is not a design
 * token, but it is the value the part actually uses, so it is reported under
 * its own name; the `sets --t-solid` rows say which token feeds it.
 */
function tokenInArbitrary(value) {
  const m = /var\(--([a-z0-9-]+)\)/i.exec(value)
  if (!m) return null
  return resolveVar(m[1]) ?? m[1]
}

/**
 * A spacing step (`4` in `p-4`, `h-8`, `gap-1.5`) → its token. The generated
 * token file sets Tailwind's base from space-1 and emits `--spacing-N` only for
 * steps that aren't N × base, so: an override names its token; an on-scale
 * step with a token of its own is that token; any other step is a multiple of
 * the base (`space-1` × 11). Null when no spacing base is generated.
 */
const SPACING_BASE = resolveVar("spacing")
function spacingValue(step) {
  if (!/^\d+(\.\d+)?$/.test(step)) return null
  const override = cssVarAlias.get(`spacing-${step}`)
  if (override) {
    const t = resolveVar(override)
    if (t) return { token: t }
  }
  if (!SPACING_BASE) return null
  if (SEMANTIC.has(`space-${step}`)) return { token: `space-${step}` }
  return { derived: `\`${SPACING_BASE}\` × ${step}` }
}

// ---------------------------------------------------------------------------
// Classifying one utility class into Attribute + Token
// ---------------------------------------------------------------------------

/** Attribute order within a (part, state) group, matching the contract's tables. */
const ATTR_ORDER = [
  "background",
  "text",
  "border colour",
  "border width",
  "radius",
  "ring",
  "shadow",
  "size",
  "padding",
  "gap",
  "type",
  "easing",
]

const SIZE_PREFIXES = [
  "size",
  "h",
  "w",
  "min-w",
  "min-h",
  "max-w",
  "max-h",
  "basis",
]
const PADDING_PREFIXES = ["p", "px", "py", "pt", "pb", "pl", "pr", "ps", "pe"]
/**
 * Keyword typography the map reports. Purely presentational keywords with no
 * measurable value (`uppercase`, `italic`, `whitespace-nowrap`) are left out,
 * so the type rows stay the ones a designer can check against a type style.
 */
const TYPE_WORDS = new Set([
  "text-balance",
  "text-center",
  "text-left",
  "text-right",
  "text-current",
])

/**
 * Classify a bare utility (variants already stripped).
 * Returns {attribute, token} where `token` is a semantic name, or
 * {attribute, fixed} for a value that is not traced to a token, or null to
 * drop the class (layout, transitions, transforms and the like are not
 * styling the map is about).
 */
function classify(raw) {
  // An importance marker says how hard the rule pushes, not what it sets.
  // (Sonner's stylesheet outranks plain utilities, so its classes carry `!`.)
  const cls = raw.replace(/!$/, "").replace(/^!/, "")

  // A custom property set inline: `[--t-solid:var(--primary-normal)]`.
  const prop = /^\[--([a-z0-9-]+):(.+)\]$/i.exec(cls)
  if (prop) {
    const token = tokenInArbitrary(prop[2]) ?? resolveVar(prop[2])
    return token ? { attribute: `sets --${prop[1]}`, token } : null
  }

  if (TYPE_WORDS.has(cls)) return { attribute: "type", fixed: raw }

  const dash = cls.indexOf("-")
  const head = dash === -1 ? cls : cls.slice(0, dash)
  const tail = dash === -1 ? "" : cls.slice(dash + 1)

  const arbitrary = (v) => /^[[(].*[\])]$/.test(v)
  const valueToken = (v) =>
    arbitrary(v) ? tokenInArbitrary(v.slice(1, -1)) : colorToken(v)

  switch (head) {
    case "bg": {
      const token = valueToken(tail)
      return token ? { attribute: "background", token } : null
    }
    case "text": {
      // `text-sm`, `text-[15px]`, `text-sm/relaxed` are type; a colour is text.
      const token = valueToken(tail)
      if (token) return { attribute: "text", token }
      return { attribute: "type", fixed: raw }
    }
    case "border": {
      if (tail === "") return null // bare `border` is a 1px default, not a value
      const token = valueToken(tail)
      if (token) return { attribute: "border colour", token }
      // A width: `border-2`, `border-0`, `border-[1.5px]`.
      if (/^(\d+|\[[^\]]+\])$/.test(tail))
        return { attribute: "border width", fixed: raw }
      return null // `border-solid`, `border-t` and friends are not values
    }
    case "rounded": {
      const token = resolveVar(`radius-${tail || "DEFAULT"}`)
      if (token) return { attribute: "radius", token }
      const inner = arbitrary(tail) ? tokenInArbitrary(tail.slice(1, -1)) : null
      return inner
        ? { attribute: "radius", token: inner }
        : { attribute: "radius", fixed: raw }
    }
    case "ring":
    case "outline": {
      const token = valueToken(tail)
      return token ? { attribute: "ring", token } : null
    }
    case "shadow": {
      const token = resolveVar(`shadow-${tail}`) ?? valueToken(tail)
      return token ? { attribute: "shadow", token } : null
    }
    case "ease": {
      const token = resolveVar(`ease-${tail}`)
      return token ? { attribute: "easing", token } : null
    }
    case "font":
    case "leading":
    case "tracking":
      return { attribute: "type", fixed: raw }
    case "gap":
      return { attribute: "gap", ...(spacingValue(tail.replace(/^[xy]-/, "")) ?? { fixed: raw }) }
  }

  // Multi-segment heads (`min-w-0`, `max-h-[…]`, `px-3`).
  // Longest prefix first, so `min-w-8` isn't read as `w-…`.
  for (const p of [...SIZE_PREFIXES].sort((a, b) => b.length - a.length)) {
    if (cls === p || cls.startsWith(`${p}-`))
      return { attribute: "size", ...(spacingValue(cls.slice(p.length + 1)) ?? { fixed: raw }) }
  }
  for (const p of PADDING_PREFIXES) {
    if (cls.startsWith(`${p}-`))
      return { attribute: "padding", ...(spacingValue(cls.slice(p.length + 1)) ?? { fixed: raw }) }
  }

  return null
}

// ---------------------------------------------------------------------------
// Variant prefixes → the State or variant column
// ---------------------------------------------------------------------------

/** Prefixes that qualify *when* a rule applies without being a design state. */
const IGNORED_PREFIXES = new Set([
  "motion-safe",
  "motion-reduce",
  "rtl",
  "ltr",
  "print",
  "supports-[backdrop-filter]",
])

/** Split `a:b-[x:y]:c` on top-level colons only. */
function splitVariants(cls) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i]
    if (c === "[" || c === "(") depth++
    else if (c === "]" || c === ")") depth--
    else if (c === ":" && depth === 0) {
      parts.push(cls.slice(start, i))
      start = i + 1
    }
  }
  parts.push(cls.slice(start))
  return parts
}

/**
 * `data-[panel-open]` → `panel-open`; `group-data-[size=sm]/switch` →
 * `size=sm`; `*` stays `*`. A `group-*` prefix names where the state lives,
 * not the state, so it is dropped — except `group-has-*`, which is a
 * different condition and stays as written.
 */
function prettyPrefix(p) {
  let s = p.replace(/\/[A-Za-z0-9_-]+$/, "")
  if (/^group-(data-|aria-|active|hover|focus|disabled|open|checked)/.test(s))
    s = s.slice(6)
  const arb = /^data-\[(.+)\]$/.exec(s)
  if (arb) return arb[1]
  if (s.startsWith("data-")) return s.slice(5)
  if (s.startsWith("aria-")) return s.slice(5)
  return s
}

// ---------------------------------------------------------------------------
// Walking the component's TSX for (part, state, class string)
// ---------------------------------------------------------------------------

/** `dropdown-menu-sub-trigger` under component DropdownMenu → `sub-trigger`. */
function partName(slot, componentKebab) {
  if (slot === componentKebab) return "base"
  if (slot.startsWith(`${componentKebab}-`))
    return slot.slice(componentKebab.length + 1)
  return slot
}

function kebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
}

/**
 * Collect {part, state, classes} triples from one source file.
 * `state` is the cva variant selector; Tailwind variant prefixes are added
 * later, per class.
 */
function collectFromFile(file, componentKebab, out) {
  const fileKebab = file.replace(/^.*\//, "").replace(/\.tsx?$/, "")
  const src = readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  // Icon components are not parts: an icon sized inside an item is that
  // item's styling. Everything imported from the icon library is skipped
  // when naming a part.
  const iconLibrary = componentsJson.iconLibrary ?? "lucide"
  const icons = new Set()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    const from = stmt.moduleSpecifier.getText(sf).replace(/['"]/g, "")
    if (!from.includes(iconLibrary)) continue
    const bindings = stmt.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings))
      for (const el of bindings.elements) icons.add(el.name.text)
  }

  // Module-level consts, so a shared class string resolves to the element that
  // uses it rather than to whatever happened to be declared above it.
  const consts = new Map()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer)
        consts.set(d.name.text, d.initializer)
    }
  }

  /** Flatten an expression into [{state, text}] class strings. */
  function classStrings(node, state, seen = new Set()) {
    if (!node) return []
    if (ts.isParenthesizedExpression(node))
      return classStrings(node.expression, state, seen)

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return [{ state, text: node.text }]

    if (ts.isTemplateExpression(node)) {
      const out = [{ state, text: node.head.text }]
      for (const span of node.templateSpans) {
        out.push(...classStrings(span.expression, state, seen))
        out.push({ state, text: span.literal.text })
      }
      return out
    }

    if (ts.isArrayLiteralExpression(node))
      return node.elements.flatMap((e) => classStrings(e, state, seen))

    if (ts.isConditionalExpression(node))
      return [
        ...classStrings(node.whenTrue, state, seen),
        ...classStrings(node.whenFalse, state, seen),
      ]

    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    )
      return [
        ...classStrings(node.left, state, seen),
        ...classStrings(node.right, state, seen),
      ]

    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return []
      const init = consts.get(node.text)
      if (!init) return []
      return classStrings(init, state, new Set([...seen, node.text]))
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee) ? callee.text : ""
      if (name === "cn" || name === "clsx" || name === "cx")
        return node.arguments.flatMap((a) => classStrings(a, state, seen))
      // `[...].join(" ")` — a long class list broken over lines.
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "join"
      )
        return classStrings(callee.expression, state, seen)
      if (name === "cva") return cvaStrings(node, state)
      // `buttonVariants({…})` or another component's cva — resolve it, but only
      // when it is declared in this file, so Button's own rows stay Button's.
      const init = ts.isIdentifier(callee) ? consts.get(callee.text) : null
      if (init && ts.isCallExpression(init) && isCva(init) && !seen.has(name))
        return cvaStrings(init, state)
      return []
    }

    return []
  }

  const isCva = (n) =>
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === "cva"

  /** Expand a cva() call into base, per-variant and compound class strings. */
  function cvaStrings(call, outerState) {
    const res = []
    const join = (s) => (outerState && outerState !== "—" ? `${outerState} · ${s}` : s)
    const [base, config] = call.arguments
    res.push(...classStrings(base, outerState ?? "—"))
    if (!config || !ts.isObjectLiteralExpression(config)) return res

    for (const prop of config.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const key = prop.name.getText(sf).replace(/['"]/g, "")

      if (key === "variants" && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const group of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(group)) continue
          const axis = group.name.getText(sf).replace(/['"]/g, "")
          if (!ts.isObjectLiteralExpression(group.initializer)) continue
          for (const entry of group.initializer.properties) {
            if (!ts.isPropertyAssignment(entry)) continue
            const value = entry.name.getText(sf).replace(/['"]/g, "")
            res.push(...classStrings(entry.initializer, join(`${axis}=${value}`)))
          }
        }
      }

      if (key === "compoundVariants" && ts.isArrayLiteralExpression(prop.initializer)) {
        for (const entry of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(entry)) continue
          for (const p of entry.properties) {
            if (!ts.isPropertyAssignment(p)) continue
            const k = p.name.getText(sf).replace(/['"]/g, "")
            if (k === "class" || k === "className")
              res.push(...classStrings(p.initializer, join("compound")))
          }
        }
      }
    }
    return res
  }

  /**
   * Classes reach an element two ways: as JSX attributes, and as a props
   * object (Base UI's `useRender`, Sonner's `toastOptions`). Both are read
   * the same way, so a component that composes rather than renders JSX is
   * not silently skipped.
   */
  function propReader(node) {
    if (ts.isJsxOpeningLikeElement(node)) {
      const attrs = node.attributes.properties
      return (name) => {
        const a = attrs.find(
          (x) => ts.isJsxAttribute(x) && x.name.getText(sf) === name
        )
        if (!a?.initializer) return null
        return ts.isJsxExpression(a.initializer)
          ? a.initializer.expression
          : a.initializer
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const has = node.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          ["className", "classNames", "data-slot"].includes(
            p.name.getText(sf).replace(/['"]/g, "")
          )
      )
      if (!has) return null
      return (name) => {
        const p = node.properties.find(
          (x) =>
            ts.isPropertyAssignment(x) &&
            x.name.getText(sf).replace(/['"]/g, "") === name
        )
        return p && ts.isPropertyAssignment(p) ? p.initializer : null
      }
    }
    return null
  }

  // Walk, carrying the nearest enclosing data-slot and, failing that, the
  // enclosing function's name.
  function walk(node, slot, fnName) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name
    )
      fnName = node.name.text
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    )
      fnName = node.name.text

    let localSlot = slot
    const get = propReader(node)
    if (get) {
      const slotNode = get("data-slot")
      if (slotNode && ts.isStringLiteral(slotNode)) localSlot = slotNode.text

      // A library primitive nested inside a slotted element is its own part
      // (Popover's Arrow inside the Popup), not more styling for the parent.
      // Only PascalCase tags count: a bare <div> is a wrapper, not a part.
      let tagPart = null
      if (!slotNode && ts.isJsxOpeningLikeElement(node)) {
        const full = node.tagName.getText(sf)
        const tag = full.split(".").pop() ?? ""
        if (/^[A-Z]/.test(tag) && !icons.has(full)) tagPart = kebab(tag)
      }

      const part = tagPart
        ? partName(tagPart, componentKebab)
        : localSlot
          ? partName(localSlot, componentKebab)
          : partName(kebab(fnName ?? "base"), componentKebab)

      const cn = get("className")
      if (cn)
        for (const { state, text } of classStrings(cn, "—"))
          out.push({ part, state, text })

      // react-day-picker and Sonner take a map of part → classes. The keys
      // are part names already, qualified by the file they come from so a
      // multi-file component says which piece a row belongs to
      // (DatePicker: `calendar-today`; Sonner: plain `title`).
      const cns = get("classNames")
      if (cns && ts.isObjectLiteralExpression(cns)) {
        for (const p of cns.properties) {
          if (!ts.isPropertyAssignment(p)) continue
          const key = kebab(p.name.getText(sf).replace(/['"]/g, "")).replace(
            /_/g,
            "-"
          )
          const sub = fileKebab === componentKebab ? key : `${fileKebab}-${key}`
          for (const { state, text } of classStrings(p.initializer, "—"))
            out.push({ part: sub, state, text })
        }
      }
    }

    ts.forEachChild(node, (c) => walk(c, localSlot, fnName))
  }

  walk(sf, null, null)
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function rowsFor(component, files) {
  const componentKebab = kebab(component)
  const raw = []
  for (const f of files) collectFromFile(f, componentKebab, raw)

  const rows = new Map() // key → row, so a class repeated across files lands once
  for (const { part, state, text } of raw) {
    for (const cls of text.split(/\s+/).filter(Boolean)) {
      const segments = splitVariants(cls)
      const bare = segments.pop()
      const prefixes = segments
        .filter((p) => !IGNORED_PREFIXES.has(p))
        .map(prettyPrefix)

      const result = classify(bare)
      if (!result) continue

      const stateParts = []
      if (state && state !== "—") stateParts.push(state)
      stateParts.push(...prefixes)
      const stateText = stateParts.length ? stateParts.join(" · ") : "—"

      const value = result.token
        ? `\`${result.token}\``
        : result.derived ?? `${result.fixed} — fixed in code`
      const key = `${part}\u0000${stateText}\u0000${result.attribute}\u0000${value}`
      if (!rows.has(key))
        rows.set(key, { part, state: stateText, attribute: result.attribute, value })
    }
  }

  const list = [...rows.values()]
  const partRank = (p) => (p === "base" ? "" : p)
  const stateRank = (s) => (s === "—" ? "" : s)
  list.sort(
    (a, b) =>
      partRank(a.part).localeCompare(partRank(b.part)) ||
      stateRank(a.state).localeCompare(stateRank(b.state)) ||
      ATTR_ORDER.indexOf(a.attribute) - ATTR_ORDER.indexOf(b.attribute) ||
      a.attribute.localeCompare(b.attribute) ||
      a.value.localeCompare(b.value)
  )
  return list
}

/** The files a component is built from. */
function filesFor(component) {
  const listed = EXTRA_FILES[component]
  const names = listed ?? [`${kebab(component)}.tsx`]
  const paths = names.map((n) => join(UI, n))
  for (const p of paths)
    if (!existsSync(p)) throw new Error(`no such component file: ${p}`)
  return paths
}

function tableFor(component) {
  const files = filesFor(component)
  const rows = rowsFor(component, files)
  const rel = files.map((f) => `\`${f.slice(REPO.length + 1)}\``).join(", ")
  const date = new Date().toISOString().slice(0, 10)
  const lines = [
    `**Styling map** — generated from ${rel} on ${date}. Values come from the code; a token change regenerates the token file, not this table.`,
    "",
    "| Part | State or variant | Attribute | Token |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.part} | ${r.state} | ${r.attribute} | ${r.value} |`),
  ]
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Used by: which components each token styles
// ---------------------------------------------------------------------------

/**
 * Every component in the UI directory: one per file, except files that a
 * `componentFiles` entry groups under another name (label.tsx under Input).
 */
function allComponents() {
  const grouped = new Set(Object.values(EXTRA_FILES).flat())
  const single = readdirSync(UI)
    .filter((f) => f.endsWith(".tsx") && !/\.(test|spec|stories)\.tsx$/.test(f) && !grouped.has(f))
    .map((f) => f.replace(/\.tsx$/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(""))
  return [...new Set([...single, ...Object.keys(EXTRA_FILES)])].sort()
}

/** token → sorted component names, from every component's styling map. */
function usedBy() {
  const map = new Map()
  for (const c of allComponents()) {
    for (const row of rowsFor(c, filesFor(c))) {
      const m = /^`([^`]+)`$/.exec(row.value)
      if (!m || !SEMANTIC.has(m[1])) continue
      if (!map.has(m[1])) map.set(m[1], new Set())
      map.get(m[1]).add(c)
    }
  }
  return map
}

/**
 * Rewrite each token's usage text so it ends with "Used by A, B." (or with no
 * Used-by clause when nothing uses it). Keeps the file's own formatting.
 */
function writeUsedBy(inPath, outPath) {
  const raw = readFileSync(inPath, "utf8")
  const data = JSON.parse(raw)
  const users = usedBy()
  let changed = 0
  for (const group of Object.values(data)) {
    if (!group || !Array.isArray(group.tokens)) continue
    for (const t of group.tokens) {
      if (typeof t.usage !== "string") continue
      const base = t.usage.replace(/\s*Used by [^.]*\.\s*$/, "").trimEnd()
      const list = users.get(t.name)
      const next = list ? `${base} Used by ${[...list].sort().join(", ")}.` : base
      if (next !== t.usage) { t.usage = next; changed++ }
    }
  }
  const indent = /^\{\n( +)"/.exec(raw)?.[1]?.length ?? 2
  const text = JSON.stringify(data, null, indent) + (raw.endsWith("\n") ? "\n" : "")
  if (outPath) writeFileSync(outPath, text)
  else process.stdout.write(text)
  console.error(`Used by: ${users.size} tokens styled by ${allComponents().length} components; ${changed} usage notes changed`)
}

// ---------------------------------------------------------------------------
// Using in code: the design system's section, from the generated token file
// ---------------------------------------------------------------------------

function usingInCode() {
  const css = readFileSync(join(REPO, dsConfig.tokensOut), "utf8")
  const theme = /@theme inline \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ""
  const prefix = dsConfig.typeClassPrefix ?? "type-"
  const client = tokens.name ?? dsConfig.namespace ?? "this system"
  const code = (x) => `\`${x}\``
  const rows = []

  // Colour utilities, in the token file's order.
  const shadcn = [], aliases = []
  for (const m of theme.matchAll(/--color-([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)/g)) {
    const [, util, target] = m
    if (util === target && SEMANTIC.has(util)) continue // same-name utilities: the bullet covers them
    const token = resolveVar(target)
    if (!token) continue
    ;(cssVarAlias.has(target) && target === util ? shadcn : aliases).push([util, token])
  }
  // shadcn's own names: each with its -foreground partner.
  const seen = new Set()
  for (const [util, token] of shadcn) {
    if (seen.has(util)) continue
    // shadcn pairs `background` with plain `foreground`; every other name with `<name>-foreground`.
    const fg = shadcn.find(([u]) => u === (util === "background" ? "foreground" : `${util}-foreground`))
    seen.add(util)
    if (fg) { seen.add(fg[0]); rows.push([`${code(util)} · ${code(fg[0])}`, `${code(token)} · ${code(fg[1])}`]) }
    else rows.push([code(util), code(token)])
  }
  // Tailwind-only names: grouped under their stem (`brand-secondary` + `-soft` …).
  const used = new Set()
  for (const [util, token] of aliases) {
    if (used.has(util)) continue
    const family = aliases.filter(([u]) => u.startsWith(`${util}-`))
    used.add(util)
    family.forEach(([u]) => used.add(u))
    if (family.length) {
      rows.push([
        `${code(util)} (+ ${family.map(([u]) => code(u.slice(util.length))).join(", ")})`,
        [token, ...family.map(([, t]) => t)].map(code).join(" · "),
      ])
    } else rows.push([code(util), code(token)])
  }

  const fam = (name) => tokens[name]?.tokens ?? []
  const radius = fam("radius")
  if (radius.length)
    rows.push([radius.map((t) => code(t.name.replace(/^radius-/, "rounded-"))).join(" · "), "radius tokens (exact values, not shadcn's derived ones)"])
  const shadows = fam("shadow")
  if (shadows.length) rows.push([shadows.map((t) => code(t.name)).join(" · "), "shadow tokens (per theme)"])
  const families = Object.keys(tokens.type?.families ?? {})
  if (families.length) {
    rows.push([families.map((f) => code(`font-${f}`)).join(" · "), "loaded by the framework from the design system's fonts; the fallback stacks apply when no face loads"])
    if (/--font-heading:/.test(theme) && !families.includes("heading"))
      rows.push([code("font-heading"), families.includes("display") ? "the display family" : "the sans family"])
  }
  const styles = (tokens.type?.groups ?? []).flatMap((g) => g.styles.map((st) => st.name))
  if (styles.length) rows.push([`${code(`${prefix}<style>`)} (e.g. ${code(prefix + (styles.find((n) => /body/.test(n)) ?? styles[0]))})`, `text styles from the type groups (${styles.length})`])
  const base = fam("spacing").find((t) => t.name === "space-1")
  if (SPACING_BASE && base) {
    const overrides = [...theme.matchAll(/--spacing-((?:[a-z0-9-]|\\\.)+):\s*var\(--((?:[a-z0-9-]|\\\.)+)\)/g)].map((m) => m[1].replace(/\\\./g, "."))
    rows.push([
      "`p-N`, `m-N`, `gap-N`, `w-N` …",
      `${code("space-N")} — Tailwind's spacing base is ${code("space-1")} (${base.value}), so ${code("p-4")} = ${code("space-4")}` +
        (overrides.length ? `; named overrides for ${overrides.map((o) => code(`*-${o}`)).join(", ")}` : ""),
    ])
  }
  const easing = fam("easing"), duration = fam("duration")
  if (easing.length) rows.push([easing.map((t) => code(t.name)).join(" · "), "easing tokens"])
  if (duration.length) rows.push([duration.map((t) => code(t.name)).join(" · "), "duration tokens"])

  const examples = ["label-strong", "line-strong", "status-positive-soft"].filter((n) => SEMANTIC.has(n))
  const out = [
    "# Using in code",
    "",
    `The Tailwind names to use when building UI against ${client} — in the app, or when prototyping in Claude. Use only these: no hex values, no arbitrary colour values, no default shadcn palette classes.`,
    "",
    `- **Every semantic token is also a utility of the same name** — ${examples.map((n, i) => code(`${["text", "border", "bg"][i]}-${n}`)).join(", ")}. Primitives are never utilities.`,
    "- **Watch the naming clash:** shadcn's `secondary` and `accent` are neutral greys. Brand colours are `brand-secondary` and `brand-accent`.",
    `- **Text styles** are ${code(`${prefix}<style>`)} classes, one per style in the type scale.`,
    "",
    "| shadcn / Tailwind | Semantic token |",
    "|---|---|",
    ...rows.map(([a, b]) => `| ${a} | ${b} |`),
    "",
    ...(dsConfig.usingInCode?.notes ?? []).flatMap((n) => [n, ""]),
    `Generated from the repo's token file (${code(dsConfig.tokensOut)}) by ${code("ds-styling-maps.mjs --using-in-code")}; every publish-back regenerates it.`,
    "",
  ]
  return out.join("\n")
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
if (args[0] === "--used-by") {
  if (!args[1]) {
    console.error("usage: ds-styling-maps.mjs --used-by <tokens.json> [<out.json>]")
    process.exit(1)
  }
  writeUsedBy(resolve(args[1]), args[2] ? resolve(args[2]) : null)
} else if (args[0] === "--using-in-code") {
  const md = usingInCode()
  if (args[1]) writeFileSync(resolve(args[1]), md)
  else process.stdout.write(md)
} else if (args[0] === "--all") {
  const names = allComponents()
  for (const c of names) {
    console.log(`\n<!-- ${c} -->`)
    console.log(tableFor(c))
  }
} else if (args.length) {
  console.log(tableFor(args[0]))
} else {
  console.error("usage: ds-styling-maps.mjs <Component> | --all | --used-by <tokens.json> [<out>] | --using-in-code [<out.md>]")
  process.exit(1)
}
