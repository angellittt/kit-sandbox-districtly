// design-system-kit 0.5.0 · profile shadcn · harness: script-test helpers
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SHADCN_MAP, ALIAS_COLORS } from "../ds-tokens.mjs"
import { KIT_VERSION } from "../ds-validate.mjs"

/** A token snapshot with every semantic token the mapping needs. */
export function snapshot(overrides = {}) {
  const names = new Set([...Object.values(SHADCN_MAP), ...Object.values(ALIAS_COLORS)])
  const tokens = [
    { name: "neutral-0", value: "#000000", usage: "Primitive neutral step 0." },
    { name: "neutral-100", value: "#ffffff", usage: "Primitive neutral step 100." },
  ]
  for (const n of names) {
    const light = /^(background|card|fill|material|inverse-background|primary-soft|secondary-soft|accent-soft)|soft$/.test(n) ? "{neutral-100}" : "{neutral-0}"
    tokens.push({ name: n, value: { light, dark: light === "{neutral-100}" ? "{neutral-0}" : "{neutral-100}" }, usage: `${n}.` })
  }
  return {
    name: "Probe",
    version: 1,
    color: { themes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }], tokens },
    spacing: { tokens: [{ name: "space-1", value: "4px", usage: "Base." }] },
    radius: { tokens: [{ name: "radius-md", value: "8px", usage: "Buttons." }] },
    ...overrides,
  }
}

export const goodConfig = () => ({
  designSystem: "https://claude.ai/artifact/probe",
  tracker: "https://app.clickup.com/1/v/l/li/2",
  schema: "ttt-ds/1",
  profile: "shadcn",
  kitVersion: KIT_VERSION,
  tokensIn: ".ttt/tokens.json",
  tokensOut: "src/styles/ds-tokens.css",
  lastSynced: "2026-10-07T18:00:00Z",
  typeClassPrefix: "type-",
  namespace: "Probe",
  bundleExtras: { sonner: ["toast"] },
  componentFiles: { Button: ["button.tsx"] },
  contrast: { intentional: [{ foreground: "label-disable", reason: "disabled" }] },
  usingInCode: { notes: [] },
})

/** The app's locale module, as Setup seeds it. */
export const localeModule = ({ tag = "en-US", name = "enUS", week = 1, format = "DD/MM/YYYY" } = {}) =>
  `import { ${name} } from "date-fns/locale"\nimport type { Locale } from "date-fns"\nexport const localeTag = "${tag}"\nexport const locale: Locale = ${name}\nexport const weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = ${week}\nexport const dateFormat: string = "${format}"\n`

/** A minimal repo on disk: config, snapshot, components.json, tsconfig, global CSS, locale module. */
export function repo({ config = goodConfig(), tokens = snapshot(), css = '@import "tailwindcss";\n@source "../";\n', files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ds-script-test-"))
  const write = (p, text) => {
    mkdirSync(join(dir, p, ".."), { recursive: true })
    writeFileSync(join(dir, p), typeof text === "string" ? text : JSON.stringify(text, null, 2))
  }
  write(".ttt/design-system.json", config)
  write(".ttt/tokens.json", tokens)
  write("components.json", { tailwind: { css: "src/app/globals.css" }, aliases: { ui: "@/components/ui", lib: "@/lib" } })
  write("tsconfig.json", '{\n  // comments are allowed\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } }\n}\n')
  write("src/app/globals.css", css)
  write("src/components/ui/button.tsx", "export function Button() { return null }\n")
  write("src/lib/locale.ts", localeModule())
  for (const [p, text] of Object.entries(files)) write(p, text)
  return dir
}
