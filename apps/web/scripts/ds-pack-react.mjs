#!/usr/bin/env node
// design-system-kit 0.4.1 · profile shadcn · kit file — fix it in the kit, not per client
/**
 * Pack React and ReactDOM as classic-script globals for a design system's
 * `components/lib/`.
 *
 * Why this exists: React 19 ships no UMD build, and the design system's
 * preview frame loads plain <script> files that must define window.React and
 * window.ReactDOM before bundle.js runs. React 18 could be taken straight
 * from a CDN; 19 has to be packed.
 *
 * Generic on purpose — it reads the versions out of the consuming repo's
 * lockfile and takes the output directory as an argument, so it is the same
 * file in every client repo.
 *
 *   node scripts/ds-pack-react.mjs <out-dir>
 *
 * Writes <out-dir>/react.js, <out-dir>/react-dom.js and prints the
 * `libraries` entries to put in the design system's index.
 */
import { build } from "esbuild"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { installedVersion } from "./ds-validate.mjs"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = resolve(process.argv[2] ?? join(REPO, "dist/ds-lib"))
mkdirSync(OUT, { recursive: true })

const versionOf = (p) => {
  const v = installedVersion(REPO, p)
  if (!v) throw new Error(`${p} isn't installed where this app can reach it`)
  return v
}

/**
 * The preview frame loads these in order, so react-dom must not carry its
 * own copy of react — it reads the global the first script defined.
 */
const reactGlobalShim = {
  name: "react-global",
  setup(b) {
    b.onResolve({ filter: /^react$/ }, (a) => ({
      path: a.path,
      namespace: "react-global",
    }))
    b.onLoad({ filter: /.*/, namespace: "react-global" }, () => ({
      contents: `module.exports = globalThis.React;`,
      loader: "js",
    }))
  },
}

/**
 * A classic script cannot contain `</script` or `<!--`: consumers inline
 * these files into a <script> element and either sequence would end or
 * comment out the element. Escaping keeps the JS semantics identical.
 */
function makeInlineSafe(code, label) {
  const before = (code.match(/<\/script|<!--/gi) ?? []).length
  const safe = code
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--")
  if (before) console.log(`  ${label}: escaped ${before} inline-unsafe sequence(s)`)
  return safe
}

async function pack({ entry, globalName, outfile, external = [], plugins = [] }) {
  const tmp = join(OUT, `.entry-${globalName}.js`)
  writeFileSync(tmp, entry)
  const r = await build({
    absWorkingDir: REPO,
    entryPoints: [tmp],
    outfile: join(OUT, outfile),
    bundle: true,
    format: "iife",
    globalName,
    platform: "browser",
    target: ["es2020"],
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    external,
    plugins,
    // The entry is written into the output directory, which may sit outside
    // the repo, so bare specifiers need the repo's tree explicitly.
    nodePaths: [join(REPO, "node_modules")],
    logLevel: "warning",
    write: false,
  })
  const code = r.outputFiles[0].text
  const safe = makeInlineSafe(code, outfile)
  writeFileSync(join(OUT, outfile), safe)
  writeFileSync(tmp, "")
  return safe.length
}

const reactVersion = versionOf("react")
const reactDomVersion = versionOf("react-dom")

console.log(`packing react@${reactVersion} and react-dom@${reactDomVersion} -> ${OUT}`)

// React: the whole public surface under window.React.
const reactBytes = await pack({
  entry: `export * from "react";\nimport * as R from "react";\nexport default R.default ?? R;\n`,
  globalName: "React",
  outfile: "react.js",
})

// ReactDOM: the DOM client plus the stable react-dom surface, so previews can
// call ReactDOM.createRoot (19's entry point) and createPortal alike.
const reactDomBytes = await pack({
  entry: [
    `import * as client from "react-dom/client";`,
    `import * as dom from "react-dom";`,
    `export const createRoot = client.createRoot;`,
    `export const hydrateRoot = client.hydrateRoot;`,
    `export const createPortal = dom.createPortal;`,
    `export const flushSync = dom.flushSync;`,
    `export const version = dom.version;`,
    `export default { ...dom, ...client };`,
    "",
  ].join("\n"),
  globalName: "ReactDOM",
  outfile: "react-dom.js",
  plugins: [reactGlobalShim],
})

// esbuild's IIFE assigns `var React = (() => {…})()`, which at top level of a
// classic script is already window.React. Make it explicit so the files work
// inside a module or a wrapper too.
for (const [file, name] of [["react.js", "React"], ["react-dom.js", "ReactDOM"]]) {
  const p = join(OUT, file)
  writeFileSync(p, readFileSync(p, "utf8") + `\nwindow.${name}=${name};\n`)
}

const libraries = [
  { name: "react", version: reactVersion, global: "React", file: "components/lib/react.js" },
  { name: "react-dom", version: reactDomVersion, global: "ReactDOM", file: "components/lib/react-dom.js" },
]

console.log(`  react.js      ${(reactBytes / 1024).toFixed(0)} KB`)
console.log(`  react-dom.js  ${(reactDomBytes / 1024).toFixed(0)} KB`)
console.log(`\nlibraries entries for the design system index:`)
console.log(JSON.stringify(libraries, null, 1))
writeFileSync(join(OUT, "libraries.json"), JSON.stringify(libraries, null, 1) + "\n")
