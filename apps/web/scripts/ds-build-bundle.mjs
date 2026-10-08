#!/usr/bin/env node
// design-system-kit 0.5.0 · profile shadcn · kit file — fix it in the kit, not per client
/**
 * Build the design system's preview bundle from a repo's component layer.
 *
 * The design system renders each component live in a frame that loads plain
 * classic scripts: the packed React globals (see ds-pack-react.mjs), then
 * bundle.js, which must assign window.<namespace>. Nothing else can build
 * these components — the design system's own `--components-src` route is
 * fenced to sources importing only relative files and react/react-dom, and
 * ours import @base-ui/react, cva, lucide-react and sonner.
 *
 *   node scripts/ds-build-bundle.mjs <out-dir>     build bundle.js + bundle.css
 *   node scripts/ds-build-bundle.mjs --check       verify the toolchain pins
 *
 * KIT FILE — this runs against any repo on profile `shadcn` 1.2. Everything
 * repo-specific is resolved, not hardcoded:
 *
 *   namespace, extra exports  .ttt/design-system.json  (namespace, bundleExtras)
 *   component directory       components.json          (aliases.ui)
 *   path alias                tsconfig.json            (compilerOptions.paths)
 *   token file                .ttt/design-system.json  (tokensOut)
 *
 * MAINTENANCE: it is pinned to the toolchain in PINS below. Run --check after
 * any dependency bump; the contract's "Kit tooling" section records why each
 * pin is where it is.
 */
import { build } from "esbuild"
import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
} from "node:fs"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { installedVersion } from "./ds-validate.mjs"

/**
 * Where the dependencies live — always the repo this script is installed in.
 * In normal use that is also where the config lives.
 */
const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Where the config and components live. `--repo <path>` points it elsewhere,
 * which is how the fixture exercises the resolution logic against a layout
 * that is not this repo's.
 */
const repoFlag = process.argv.indexOf("--repo")
const REPO = repoFlag !== -1
  ? resolve(process.argv[repoFlag + 1])
  : TOOL_ROOT

/**
 * Toolchain this script is written against.
 *   minor — the API surface it uses moves within a minor (Tailwind's @source
 *           and @theme, Base UI's part names)
 *   major — only a major realistically breaks it (React's export shape,
 *           esbuild's plugin and banner API)
 */
const PINS = {
  tailwindcss: { want: "4.3", level: "minor" },
  "@tailwindcss/cli": { want: "4.3", level: "minor" },
  "@base-ui/react": { want: "1.8", level: "minor" },
  esbuild: { want: "0", level: "major" },
  react: { want: "19", level: "major" },
}

// ---- repo configuration ----------------------------------------------------

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

function loadConfig() {
  const dsPath = join(REPO, ".ttt/design-system.json")
  if (!existsSync(dsPath)) {
    throw new Error(".ttt/design-system.json not found — this repo is not connected to a design system")
  }
  const ds = JSON.parse(readFileSync(dsPath, "utf8"))
  for (const key of ["namespace", "tokensOut"]) {
    if (!ds[key]) throw new Error(`.ttt/design-system.json is missing "${key}"`)
  }

  const components = readJsonc(join(REPO, "components.json"))
  const tsconfig = readJsonc(join(REPO, "tsconfig.json"))
  const paths = tsconfig.compilerOptions?.paths ?? {}

  // "@/components/ui" -> src/components/ui, via tsconfig's "@/*": ["./src/*"]
  const resolveAlias = (spec) => {
    for (const [pattern, targets] of Object.entries(paths)) {
      const prefix = pattern.replace(/\*$/, "")
      if (!spec.startsWith(prefix)) continue
      const target = String(targets[0]).replace(/\*$/, "").replace(/^\.\//, "")
      return join(REPO, target + spec.slice(prefix.length))
    }
    return join(REPO, spec)
  }

  const uiAlias = components.aliases?.ui
  if (!uiAlias) throw new Error('components.json is missing "aliases.ui"')
  const uiDir = resolveAlias(uiAlias)
  if (!existsSync(uiDir)) throw new Error(`component directory not found: ${uiDir}`)

  // the bare alias prefix esbuild needs, e.g. "@" -> <repo>/src
  const aliasEntries = {}
  for (const [pattern, targets] of Object.entries(paths)) {
    const from = pattern.replace(/\/\*$/, "")
    const to = String(targets[0]).replace(/\/\*$/, "").replace(/^\.\//, "")
    aliasEntries[from] = join(REPO, to)
  }

  return {
    namespace: ds.namespace,
    bundleExtras: ds.bundleExtras ?? {},
    tokensOut: join(REPO, ds.tokensOut),
    uiDir,
    aliasEntries,
    globalCss: components.tailwind?.css,
  }
}

// ---- toolchain check -------------------------------------------------------

function installedVersions() {
  const out = {}
  for (const name of Object.keys(PINS)) out[name] = installedVersion(TOOL_ROOT, name)
  return out
}

function checkPins({ quiet = false } = {}) {
  const found = installedVersions()
  const problems = []
  for (const [name, { want, level }] of Object.entries(PINS)) {
    const have = found[name]
    if (!have) { problems.push(`${name}: not installed (expected ~${want})`); continue }
    const seg = level === "major" ? 1 : 2
    const key = have.split(".").slice(0, seg).join(".")
    if (key !== want) {
      problems.push(`${name}: installed ${have}, built against ${want}.x (${level} pin)`)
    }
  }
  if (!quiet) {
    for (const [name, v] of Object.entries(found)) {
      console.log(`  ${name.padEnd(18)} ${v ?? "missing"}`)
    }
  }
  return problems
}

// ---- virtual stand-ins ------------------------------------------------------
// Derived from the installed React rather than a hand-kept list: React 19 adds
// use, useActionState, useOptimistic and useEffectEvent, and a name missing
// from the shim fails only when a dependency reaches for it.
const repoRequire = createRequire(join(TOOL_ROOT, "package.json"))
const REACT_EXPORTS = Object.keys(repoRequire("react"))
  .filter((k) => k !== "default")
  .sort()

const SHIMS = {
  react: `
const R = globalThis.React;
export default R;
export const { ${REACT_EXPORTS.join(", ")} } = R;
`,
  "react/jsx-runtime": `
const R = globalThis.React;
export const Fragment = R.Fragment;
function make(type, props, key) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  return children === undefined
    ? R.createElement(type, rest)
    : R.createElement(type, rest, children);
}
export const jsx = make;
export const jsxs = make;
export const jsxDEV = make;
`,
  "react-dom": `
const RD = globalThis.ReactDOM;
export default RD;
export const createPortal = RD.createPortal;
export const flushSync = RD.flushSync;
`,
  // The preview frame has no ThemeProvider; the design system sets data-theme
  // on <html>, which is what the token file keys off anyway. This is a
  // replacement implementation, not an external mapped to a global — which is
  // why all four go through one plugin rather than a bundler's `globals` map.
  "next-themes": `
const R = globalThis.React;
function read() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme || "light";
}
export function useTheme() {
  const [theme, set] = R.useState(read);
  R.useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => set(read()));
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return {
    theme,
    resolvedTheme: theme,
    systemTheme: theme,
    themes: ["light", "dark"],
    setTheme: (t) => { document.documentElement.dataset.theme = t; set(t); },
  };
}
export function ThemeProvider({ children }) { return children; }
`,
}

const shimPlugin = {
  name: "preview-shims",
  setup(b) {
    const names = Object.keys(SHIMS)
    const filter = new RegExp(`^(${names.map((n) => n.replace(/\//g, "\\/")).join("|")})$`)
    b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "shim" }))
    b.onLoad({ filter: /.*/, namespace: "shim" }, (a) => ({
      contents: SHIMS[a.path],
      loader: "js",
    }))
  },
}

// ---- caps, from the design system's format reference ------------------------
const CAP_JS = 6 * 1024 * 1024
const CAP_CSS = 2 * 1024 * 1024

/**
 * Consumers inline these files into <script>/<style> elements, where either
 * sequence would end or comment out the element.
 */
function assertInlineSafe(text, label, extra = []) {
  const bad = ["</script", "<!--", ...extra].filter((s) =>
    text.toLowerCase().includes(s.toLowerCase()))
  if (bad.length) {
    throw new Error(`${label} contains ${bad.join(", ")} — would break an inlining consumer`)
  }
}

// ---- JS --------------------------------------------------------------------

/** A component file, as opposed to a test or story sitting beside it. */
const isComponentFile = (f) =>
  f.endsWith(".tsx") && !/\.(test|spec|stories)\.tsx$/.test(f)

/** The component files, shared by the JS and CSS passes so they cannot drift. */
function componentFiles(cfg) {
  const files = readdirSync(cfg.uiDir).filter(isComponentFile).sort()
  if (!files.length) throw new Error(`no .tsx components in ${cfg.uiDir}`)
  return files
}

async function buildJs(cfg, outDir) {
  // Tests live next to the components they cover, and pull a test renderer
  // and its pretty-printer in with them — tens of thousands of lines the
  // design system never renders, carrying the `<!--` that breaks a consumer
  // inlining this into a <script>.
  const files = componentFiles(cfg)

  const extras = Object.entries(cfg.bundleExtras)
    .map(([mod, names]) => `export { ${names.join(", ")} } from "${mod}";`)
    .join("\n")

  const entry = join(outDir, ".entry.ts")
  writeFileSync(
    entry,
    files.map((f) => `export * from "${cfg.uiDir}/${f.replace(/\.tsx$/, "")}";`).join("\n") +
      (extras ? "\n" + extras + "\n" : "\n"),
  )

  const components = files.map((f) =>
    f.replace(/\.tsx$/, "").replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase()))

  // The header must be line 1 (the design system reads namespace and order
  // from it), so it leads the banner.
  const header = `/* @ds-bundle: ${JSON.stringify({
    format: 4,
    namespace: cfg.namespace,
    components: components.map((name) => ({ name })),
  })} */`

  const result = await build({
    absWorkingDir: TOOL_ROOT,
    entryPoints: [entry],
    outfile: join(outDir, "bundle.js"),
    bundle: true,
    format: "iife",
    globalName: "__DS",
    platform: "browser",
    target: ["es2020"],
    jsx: "transform",
    jsxFactory: "__R.createElement",
    jsxFragment: "__R.Fragment",
    banner: { js: `${header}\nvar __R = globalThis.React;` },
    footer: { js: `\nwindow.${cfg.namespace} = Object.assign(window.${cfg.namespace} || {}, __DS);` },
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [shimPlugin],
    alias: cfg.aliasEntries,
    // the entry is written into the output directory, which may sit outside
    // the repo, so bare specifiers need the repo's tree explicitly
    nodePaths: [join(TOOL_ROOT, "node_modules")],
    logLevel: "warning",
  })
  if (result.errors?.length) throw new Error("esbuild reported errors")
  rmSync(entry, { force: true })

  const text = readFileSync(join(outDir, "bundle.js"), "utf8")
  assertInlineSafe(text, "bundle.js")
  if (text.length > CAP_JS) {
    throw new Error(`bundle.js is ${(text.length / 1048576).toFixed(1)} MB, over the 6 MB cap`)
  }
  if (!text.startsWith("/* @ds-bundle:")) throw new Error("bundle.js header is not on line 1")
  if (!text.includes(`window.${cfg.namespace}`)) {
    throw new Error(`bundle.js does not assign window.${cfg.namespace}`)
  }
  return { bytes: text.length, modules: files.length, components }
}

// ---- CSS -------------------------------------------------------------------

async function buildCss(cfg, outDir, files) {
  // The Tailwind CLI resolves `@import "tailwindcss"` from the entry's
  // location, so the entry has to live inside the repo. It is generated, and
  // gitignored.
  const entry = join(TOOL_ROOT, ".ttt/.bundle-entry.css")
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(
    entry,
    [
      // source(none) disables Tailwind's automatic source detection, which
      // otherwise walks up from this entry and scans the whole consuming repo.
      // Only the explicit @source below should feed the design system's bundle.
      '@import "tailwindcss" source(none);',
      '@import "tw-animate-css";',
      '@import "shadcn/tailwind.css";',
      "",
      "/* Only the component layer is scanned; the consuming app's pages are",
      " * not part of the design system's preview bundle. Each component file",
      " * is listed rather than the directory, so CSS scans exactly what JS",
      " * bundles and a test file beside them cannot contribute utilities. */",
      ...files.map((f) => `@source "${cfg.uiDir}/${f}";`),
      "",
      `@import "${cfg.tokensOut}";`,
      "",
      '@custom-variant dark (&:is([data-theme="dark"] *));',
      "",
      // Written as custom properties rather than @apply: a consuming repo's
      // token file may not define every shadcn alias utility, and an unknown
      // one is a hard error in Tailwind v4. The compiled result is the same
      // wherever the tokens do exist.
      "@layer base {",
      "  * { border-color: var(--border, currentColor); }",
      "  body {",
      "    background-color: var(--background, transparent);",
      "    color: var(--foreground, inherit);",
      "    font-family: var(--font-sans, inherit);",
      "  }",
      "  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }",
      "}",
      "",
    ].join("\n"),
  )

  // The CLI's `exports` map only exposes package.json, so its entry point is
  // read from the `bin` field rather than resolved directly.
  const cliPkgPath = repoRequire.resolve("@tailwindcss/cli/package.json")
  const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf8"))
  const binRel = typeof cliPkg.bin === "string" ? cliPkg.bin : cliPkg.bin?.tailwindcss
  if (!binRel) throw new Error("@tailwindcss/cli has no bin entry")
  const cli = resolve(dirname(cliPkgPath), binRel)

  const out = join(outDir, "bundle.css")
  execFileSync(
    process.execPath,
    [cli, "-i", entry, "-o", out, "--minify"],
    { cwd: TOOL_ROOT, stdio: ["ignore", "ignore", "inherit"] },
  )
  rmSync(entry, { force: true })

  const text = readFileSync(out, "utf8")
  assertInlineSafe(text, "bundle.css", ["</style"])
  if (text.length > CAP_CSS) {
    throw new Error(`bundle.css is ${(text.length / 1048576).toFixed(1)} MB, over the 2 MB cap`)
  }
  return { bytes: text.length }
}

// ---- main ------------------------------------------------------------------

const argv = process.argv.slice(2).filter((a, i, all) =>
  a !== "--repo" && all[i - 1] !== "--repo")
const arg = argv[0]

if (arg === "--check") {
  console.log("toolchain:")
  const problems = checkPins()
  if (problems.length) {
    console.error("\nds-build-bundle is pinned to a different toolchain:")
    for (const p of problems) console.error(`  - ${p}`)
    console.error("\nRebuild and compare the output before publishing back.")
    process.exit(1)
  }
  console.log("\nall pins match")
  process.exit(0)
}

if (!arg) {
  console.error("usage: node scripts/ds-build-bundle.mjs <out-dir> | --check")
  process.exit(2)
}

const outDir = resolve(arg)
mkdirSync(outDir, { recursive: true })

const cfg = loadConfig()
const drift = checkPins({ quiet: true })
if (drift.length) {
  console.warn("warning: toolchain differs from the pins this script was built against:")
  for (const p of drift) console.warn(`  - ${p}`)
  console.warn("  verify the output before publishing (see --check).\n")
}

console.log(`building ${cfg.namespace} bundle from ${cfg.uiDir.replace(REPO + "/", "")}`)
const js = await buildJs(cfg, outDir)
const css = await buildCss(cfg, outDir, componentFiles(cfg))
console.log(`  bundle.js   ${(js.bytes / 1024).toFixed(0)} KB  (${js.modules} modules)`)
console.log(`  bundle.css  ${(css.bytes / 1024).toFixed(0)} KB`)
console.log(`  -> ${outDir}`)
