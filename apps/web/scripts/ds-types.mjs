#!/usr/bin/env node
// design-system-kit 0.4.1 · profile shadcn · kit file — fix it in the kit, not per client
/**
 * ds-types.mjs — `components/index.d.ts` for the design system, generated from
 * the repo's own `components/ui` exports.
 *
 * KIT FILE. Generic across repos on profile `shadcn` 1.2: the UI directory and
 * the namespace come from the consuming repo's config.
 *
 *   node scripts/ds-types.mjs                 # print to stdout
 *   node scripts/ds-types.mjs <out-file>      # write index.d.ts
 *   node scripts/ds-types.mjs --check         # fail if the file is stale
 *
 * This is the contract's "types as docs" file, not a compilation input: it
 * describes the API a preview or a consuming app sees on the bundle's global.
 * Every signature is the one written in the source, so it cannot drift into
 * describing a library the code no longer uses — which is exactly what the
 * hand-written version did.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const REPO = process.cwd()
const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ts = createRequire(join(TOOL_ROOT, "package.json"))("typescript")

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
const NAMESPACE = dsConfig.namespace ?? "UI"
const UI_ALIAS = componentsJson.aliases?.ui ?? "@/components/ui"

const isComponentFile = (f) =>
  f.endsWith(".tsx") && !/\.(test|spec|stories)\.tsx$/.test(f)

// ---------------------------------------------------------------------------
// Reading one file's exported API
// ---------------------------------------------------------------------------

/**
 * One Program over the component layer, so an unannotated return type (a
 * helper like `initialsOf`) can be printed as what it actually is rather than
 * guessed at.
 */
const parsedConfig = ts.parseJsonConfigFileContent(
  { compilerOptions: tsconfig.compilerOptions ?? {} },
  ts.sys,
  REPO
)
const program = ts.createProgram(
  readdirSync(UI).filter(isComponentFile).map((f) => join(UI, f)),
  { ...parsedConfig.options, noEmit: true }
)
const checker = program.getTypeChecker()

const printer = ts.createPrinter({ removeComments: true })

/**
 * Print a type node as one line. The printer is used rather than the source
 * text because a type literal written across lines separates its members with
 * newlines, and collapsing those by hand produces `{ a: string b: number }`.
 */
function flatten(node, sf) {
  if (typeof node === "string") return node.replace(/\s+/g, " ").trim()
  const text = printer.printNode(ts.EmitHint.Unspecified, node, sf)
  return text
    .replace(/\r?\n\s*/g, " ")
    .replace(/\s*;\s*}/g, " }")
    .replace(/\{\s+/g, "{ ")
    .replace(/\s+\}/g, " }")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/** The return type as written, or as the checker sees it. */
function returnTypeOf(node, sf) {
  if (node.type) return flatten(node.type, sf)
  try {
    const signature = checker.getSignatureFromDeclaration(node)
    if (signature) {
      const printed = checker.typeToString(
        checker.getReturnTypeOfSignature(signature),
        node,
        ts.TypeFormatFlags.NoTruncation
      )
      // A component's inferred return is a long element type; name it.
      if (/^(Element|JSX\.Element|React\.JSX\.Element|ReactElement\b)/.test(printed))
        return "React.JSX.Element"
      if (printed.length <= 80) return printed
    }
  } catch {
    /* fall through to the convention below */
  }
  return "React.JSX.Element"
}

/** `cva(base, { variants: { tone: { soft: … } } })` → the axes and their values. */
function cvaAxes(call, sf) {
  const axes = []
  const config = call.arguments[1]
  if (!config || !ts.isObjectLiteralExpression(config)) return axes
  for (const prop of config.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = prop.name.getText(sf).replace(/['"]/g, "")
    if (key === "variants" && ts.isObjectLiteralExpression(prop.initializer)) {
      for (const group of prop.initializer.properties) {
        if (!ts.isPropertyAssignment(group)) continue
        if (!ts.isObjectLiteralExpression(group.initializer)) continue
        axes.push({
          name: group.name.getText(sf).replace(/['"]/g, ""),
          values: group.initializer.properties
            .filter(ts.isPropertyAssignment)
            .map((e) => e.name.getText(sf).replace(/['"]/g, "")),
        })
      }
    }
    if (key === "defaultVariants" && ts.isObjectLiteralExpression(prop.initializer)) {
      for (const d of prop.initializer.properties) {
        if (!ts.isPropertyAssignment(d)) continue
        const axis = axes.find(
          (a) => a.name === d.name.getText(sf).replace(/['"]/g, "")
        )
        if (axis) axis.default = d.initializer.getText(sf).replace(/['"]/g, "")
      }
    }
  }
  return axes
}

function readFile(file) {
  // From the Program, not a standalone parse: the checker can only answer
  // questions about nodes it owns.
  const sf = program.getSourceFile(file)
  if (!sf) throw new Error(`not in the program: ${file}`)

  const decls = new Map() // name -> node
  const cvas = new Map() // variants-const name -> axes
  const exported = [] // names, in export order
  const typeAliases = []
  const localTypes = [] // not exported, but an exported signature may name one

  for (const stmt of sf.statements) {
    const isExported = !!stmt.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    )

    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      decls.set(stmt.name.text, stmt)
      if (isExported) exported.push(stmt.name.text)
    }

    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue
        decls.set(d.name.text, d)
        if (isExported) exported.push(d.name.text)
        if (
          d.initializer &&
          ts.isCallExpression(d.initializer) &&
          ts.isIdentifier(d.initializer.expression) &&
          d.initializer.expression.text === "cva"
        )
          cvas.set(d.name.text, cvaAxes(d.initializer, sf))
      }
    }

    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
      const entry = { name: stmt.name.text, text: flatten(stmt, sf) }
      if (isExported) typeAliases.push(entry)
      else localTypes.push(entry)
    }

    // `export { A, B }`
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (el.isTypeOnly) continue
        exported.push(el.name.text)
      }
    }
  }

  const entries = []
  for (const name of [...new Set(exported)]) {
    const node = decls.get(name)
    if (!node) continue

    // A component: function Name({...}: Props)
    if (ts.isFunctionDeclaration(node)) {
      entries.push(signatureEntry(name, node, sf, cvas))
      continue
    }

    // A re-export or alias: const X = Primitive.Root
    const init = node.initializer
    if (!init) continue
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      entries.push(signatureEntry(name, init, sf, cvas))
      continue
    }
    if (cvas.has(name)) {
      entries.push({ kind: "cva", name, axes: cvas.get(name) })
      continue
    }
    entries.push({ kind: "alias", name, text: flatten(init, sf) })
  }

  // A type the file keeps to itself is still part of the published API when
  // an exported signature names it (DatePickerProps = SingleProps | RangeProps).
  const surface = [
    ...typeAliases.map((t) => t.text),
    ...entries.map((e) =>
      e.kind === "function" ? `${e.params.join(",")}:${e.returns}` : (e.text ?? "")
    ),
  ].join(" ")
  const supporting = []
  const seen = new Set()
  let frontier = localTypes.filter((t) =>
    new RegExp(`\\b${t.name}\\b`).test(surface)
  )
  while (frontier.length) {
    const next = []
    for (const t of frontier) {
      if (seen.has(t.name)) continue
      seen.add(t.name)
      supporting.push(t)
      for (const other of localTypes)
        if (!seen.has(other.name) && new RegExp(`\\b${other.name}\\b`).test(t.text))
          next.push(other)
    }
    frontier = next
  }

  return { entries, typeAliases, supporting }
}

/**
 * One exported function, rendered as the signature the source declares.
 * A component takes a props object; a helper (`initialsOf`, `parseTyped`)
 * takes named arguments, and printing it as `props:` would be a lie.
 */
function signatureEntry(name, node, sf, cvas) {
  const params = node.parameters.map((p, i) => {
    const pname = ts.isIdentifier(p.name)
      ? p.name.text
      : i === 0 && /^[A-Z]/.test(name)
        ? "props"
        : `arg${i}`
    const type = p.type ? flatten(p.type, sf) : "unknown"
    const optional = p.questionToken || p.initializer ? "?" : ""
    return `${pname}${optional}: ${type}`
  })
  const first = node.parameters[0]?.type
  return {
    kind: "function",
    name,
    params,
    returns: returnTypeOf(node, sf),
    variants: first ? variantsFor(flatten(first, sf), cvas) : null,
  }
}

/** Expand `VariantProps<typeof buttonVariants>` into the axes it stands for. */
function variantsFor(propsType, cvas) {
  const m = /VariantProps<\s*typeof\s+([A-Za-z0-9_]+)\s*>/.exec(propsType)
  return m && cvas.has(m[1]) ? cvas.get(m[1]) : null
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(files) {
  const out = [
    `// GENERATED by scripts/ds-types.mjs from ${UI_ALIAS} — do not edit by hand.`,
    `// Run \`npm run ds:types\`; publish-back runs it too.`,
    "//",
    `// ${NAMESPACE} — shadcn/ui on Base UI, themed by ${NAMESPACE} tokens.`,
    `// Preview global: window.${NAMESPACE}. App: ${UI_ALIAS}/*`,
    "//",
    "// Types-as-docs: each signature is the one written in the component's",
    "// source, so this file cannot drift from the code it describes. Props",
    "// types that come from a library (Base UI, react-day-picker) are named,",
    "// not inlined — follow them to that library's own types.",
    "",
    `import * as React from "react";`,
    "",
  ]

  for (const [file, api] of files) {
    if (!api.entries.length && !api.typeAliases.length) continue
    api.supporting ??= []
    out.push(`// ---- ${file} ${"-".repeat(Math.max(0, 68 - file.length))}`)
    out.push("")

    const semi = (t) => t.text + (t.text.endsWith(";") ? "" : ";")
    if (api.supporting.length)
      out.push("// Not exported, but named by a signature below:")
    for (const t of api.supporting) out.push(semi(t))
    for (const t of api.typeAliases) out.push(semi(t))
    if (api.typeAliases.length || api.supporting.length) out.push("")

    for (const e of api.entries) {
      if (e.kind === "function") {
        if (e.variants?.length) {
          for (const a of e.variants)
            out.push(
              `//   ${a.name}: ${a.values.map((v) => `"${v}"`).join(" | ")}` +
                (a.default ? `  (default "${a.default}")` : "")
            )
        }
        out.push(
          `export declare function ${e.name}(${e.params.join(", ")}): ${e.returns};`
        )
      } else if (e.kind === "cva") {
        for (const a of e.axes)
          out.push(
            `//   ${a.name}: ${a.values.map((v) => `"${v}"`).join(" | ")}` +
              (a.default ? `  (default "${a.default}")` : "")
          )
        out.push(
          `export declare const ${e.name}: (props?: Record<string, unknown>) => string;`
        )
      } else {
        out.push(`export declare const ${e.name}: typeof ${e.text};`)
      }
    }
    out.push("")
  }

  // Module-level APIs the component layer only partly re-exports, but which
  // the bundle puts on the global (e.g. sonner's `toast`). They are part of
  // the published API even though no file under the UI directory declares them.
  const extras = Object.entries(dsConfig.bundleExtras ?? {})
  if (extras.length) {
    out.push(`// ---- re-exported by the bundle ${"-".repeat(44)}`)
    out.push("")
    for (const [mod, names] of extras) {
      out.push(`// from "${mod}":`)
      for (const n of names)
        out.push(`export declare const ${n}: typeof import("${mod}").${n};`)
    }
    out.push("")
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n")
}

// ---------------------------------------------------------------------------

const files = readdirSync(UI)
  .filter(isComponentFile)
  .sort()
  .map((f) => [f, readFile(join(UI, f))])

const text = render(files)

const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith("--"))

if (args.includes("--check")) {
  if (!target) {
    console.error("--check needs the path of the file to compare against")
    process.exit(1)
  }
  const current = existsSync(target) ? readFileSync(target, "utf8") : ""
  if (current.trim() !== text.trim()) {
    console.error(`${target} is stale — run: node scripts/ds-types.mjs ${target}`)
    process.exit(1)
  }
  console.log(`${target} is up to date`)
} else if (target) {
  writeFileSync(target, text.endsWith("\n") ? text : text + "\n")
  const count = files.reduce((n, [, a]) => n + a.entries.length, 0)
  console.log(`wrote ${target} — ${count} exports from ${files.length} files`)
} else {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n")
}
