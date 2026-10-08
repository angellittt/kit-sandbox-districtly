#!/usr/bin/env node
// design-system-kit 0.5.0 · profile shadcn · kit file — fix it in the kit, not per client
/**
 * Design-system token generator — schema ttt-ds/1, profile shadcn.
 *
 *   node scripts/ds-tokens.mjs [path/to/tokens.json]
 *
 * Turns the token snapshot into the project's token CSS file: every token as
 * a CSS variable, Light and Dark keyed on [data-theme], {aliases} resolved to
 * var() references, the Tailwind v4 @theme mapping from the System contract's
 * token mapping table, and the type classes from the type groups. One
 * generator covers all tokens — a token change regenerates this file and no
 * component file.
 *
 * Generic by design; this becomes a kit file. Nothing here names a brand:
 * ramps, scales, motion families and type styles are read from the data, and
 * the mapping is written against semantic token names, which the contract
 * guarantees are stable across clients. Only semantic tokens are mapped —
 * never primitives.
 *
 * Reads .ttt/design-system.json for the snapshot path, the output path and
 * any values the pre-flight recorded as adaptable.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG_PATH = resolve(ROOT, ".ttt/design-system.json");

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
  "sidebar-accent": "background-elevated",
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

/** Theme-independent scalar families, emitted as plain CSS variables. */
const SCALAR_FAMILIES = ["spacing", "radius", "easing", "duration"];

/** Families whose token names are already Tailwind theme keys. */
const THEME_FAMILIES = ["radius", "easing", "duration"];

// ---------------------------------------------------------------------------

const ALIAS = /^\{([^}]+)\}$/;

/** A custom-property name. '.' must be escaped — idents cannot contain it raw. */
const cssName = (name) => "--" + String(name).replace(/\./g, "\\.");

/**
 * A family's font stack: the loaded face, then the design system's fallback.
 * `var(--font-x, …)` keeps the declaration valid when nothing loaded a face.
 */
const fontStack = (key) =>
  `var(--font-${key}, var(--font-fallback-${key})), var(--font-fallback-${key})`;

/** A length in px, or null if it isn't one ("4px" -> 4, "0.25rem" -> 4). */
function px(value) {
  const m = /^(-?[\d.]+)(px|rem)?$/.exec(String(value).trim());
  if (!m) return null;
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
}

/** "{brand-primary-50}" -> "var(--brand-primary-50)"; literals pass through. */
function deref(value) {
  const m = ALIAS.exec(String(value).trim());
  return m ? `var(${cssName(m[1])})` : String(value).trim();
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const tokensPath = resolve(
    ROOT,
    process.argv[2] ?? config.tokensIn ?? ".ttt/tokens.json",
  );
  const outPath = resolve(ROOT, config.tokensOut);
  const typePrefix = config.typeClassPrefix ?? "type-";

  const data = JSON.parse(readFileSync(tokensPath, "utf8"));
  const themes = (data.color?.themes ?? []).map((t) => t.id);
  if (!themes.length) throw new Error("snapshot declares no colour themes");

  const colours = data.color.tokens;
  const primitives = colours.filter((t) => typeof t.value === "string");
  const semantic = colours.filter((t) => t.value && typeof t.value === "object");
  const shadows = data.shadow?.tokens ?? [];
  const families = data.type?.families ?? {};
  const groups = data.type?.groups ?? [];
  const scalars = Object.fromEntries(
    SCALAR_FAMILIES.map((f) => [f, data[f]?.tokens ?? []]),
  );

  // Every token the mapping needs must exist, or the theme would silently
  // fall back to an unset variable.
  const needed = new Set([
    ...Object.values(SHADCN_MAP),
    ...Object.values(ALIAS_COLORS),
  ]);
  const have = new Set(colours.map((t) => t.name));
  const missing = [...needed].filter((n) => !have.has(n));
  if (missing.length) {
    throw new Error(
      `tokens required by the mapping are absent from the snapshot: ${missing.join(", ")}`,
    );
  }

  const L = [];
  const w = (s = "") => L.push(s);

  w("/* GENERATED by scripts/ds-tokens.mjs — do not edit by hand.");
  w(` * Source: ${data.name} tokens.json v${data.version ?? "?"}`);
  w(` * Design system: ${config.designSystem}`);
  w(` * Schema ${config.schema} · profile ${config.profile}`);
  w(` * Snapshot synced: ${config.lastSynced}`);
  w(" *");
  w(" * Regenerate with: node scripts/ds-tokens.mjs");
  w(" */");
  w();

  // ---- primitives ---------------------------------------------------------
  w("/* Primitive ramps. Never mapped to a utility and never referenced by");
  w(" * components — the semantic layer below aliases them. */");
  w(":root {");
  for (const t of primitives) w(`  ${cssName(t.name)}: ${t.value};`);
  w("}");
  w();

  // ---- theme-independent scales ------------------------------------------
  for (const family of SCALAR_FAMILIES) {
    const tokens = scalars[family];
    if (!tokens.length) continue;
    w(`/* ${family[0].toUpperCase()}${family.slice(1)}. */`);
    w(":root {");
    for (const t of tokens) w(`  ${cssName(t.name)}: ${t.value};`);
    w("}");
    w();
  }

  // ---- font fallback stacks ----------------------------------------------
  if (Object.keys(families).length) {
    w("/* Fallback stacks. The --font-* variables themselves come from the");
    w(" * framework's font loader; these sit behind them. */");
    w(":root {");
    for (const [key, stack] of Object.entries(families)) {
      w(`  --font-fallback-${key}: ${stack};`);
    }
    w("}");
    w();
  }

  // ---- per-theme semantic colours and shadows -----------------------------
  themes.forEach((theme, i) => {
    const first = i === 0;
    const selector = first
      ? `:root,\n[data-theme="${theme}"]`
      : `[data-theme="${theme}"]`;
    w(
      `/* ${theme[0].toUpperCase()}${theme.slice(1)} theme${
        first ? " — also the default, so the page is right before the theme script runs" : ""
      }. */`,
    );
    w(`${selector} {`);
    for (const t of semantic) {
      if (!(theme in t.value)) continue;
      w(`  ${cssName(t.name)}: ${deref(t.value[theme])};`);
    }
    if (shadows.length) {
      w("");
      for (const t of shadows) {
        if (!(theme in t.value)) continue;
        w(`  ${cssName(t.name)}: ${t.value[theme]};`);
      }
    }
    w("}");
    w();
  });

  // ---- shadcn variables ---------------------------------------------------
  w("/* shadcn theme variables. Every one aliases a semantic token, so a");
  w(" * token change regenerates this file and no component file. These are");
  w(" * theme-independent because the tokens they point at are already");
  w(" * redefined per theme above. */");
  w(":root {");
  for (const [key, token] of Object.entries(SHADCN_MAP)) {
    // Where the shadcn name and the token name are the same (chart-*), the
    // token already IS the variable; aliasing it to itself would be a cycle.
    if (key === token) continue;
    w(`  --${key}: var(${cssName(token)});`);
  }
  w("}");
  w();

  // ---- Tailwind v4 @theme -------------------------------------------------
  w("@theme inline {");
  w("  /* shadcn's palette */");
  for (const key of Object.keys(SHADCN_MAP)) {
    w(`  --color-${key}: var(--${key});`);
  }

  w("");
  w("  /* Brand and inverse roles, which shadcn's names would shadow */");
  for (const [util, token] of Object.entries(ALIAS_COLORS)) {
    w(`  --color-${util}: var(${cssName(token)});`);
  }

  w("");
  w("  /* Every semantic token, as a utility of the same name */");
  for (const t of semantic) {
    w(`  --color-${t.name}: var(${cssName(t.name)});`);
  }

  // Spacing: Tailwind's base is space-1, so `p-4` = space-4. A step that is
  // not N x base gets a named override instead (`p-4` then reads that token).
  const spacing = scalars.spacing;
  const base = spacing.find((t) => t.name === "space-1");
  if (base) {
    const basePx = px(base.value);
    w("");
    w("  /* Spacing — base from space-1; off-scale steps as named overrides */");
    w(`  --spacing: var(--space-1);`);
    for (const t of spacing) {
      const step = Number(t.name.replace(/^space-/, ""));
      if (!Number.isFinite(step) || basePx == null) continue;
      const v = px(t.value);
      if (v != null && Math.abs(v - step * basePx) > 0.001) {
        w(`  ${cssName("spacing-" + t.name.replace(/^space-/, ""))}: var(${cssName(t.name)});`);
      }
    }
  }

  for (const family of THEME_FAMILIES) {
    const tokens = scalars[family];
    if (!tokens.length) continue;
    w("");
    w(`  /* ${family[0].toUpperCase()}${family.slice(1)} */`);
    for (const t of tokens) w(`  ${cssName(t.name)}: var(${cssName(t.name)});`);
  }

  if (shadows.length) {
    w("");
    w("  /* Shadows — var()s, because they differ per theme */");
    for (const t of shadows) w(`  ${cssName(t.name)}: var(${cssName(t.name)});`);
  }

  if (Object.keys(families).length) {
    w("");
    w("  /* Type families. The framework's font loader sets --font-<family>; until");
    w("   * it does (or for a family with no font file) the fallback stack applies. */");
    for (const key of Object.keys(families)) w(`  --font-${key}: ${fontStack(key)};`);
    // shadcn's headings use `font-heading`; it reads the display family.
    if (!("heading" in families)) {
      const heading = "display" in families ? "display" : "sans" in families ? "sans" : null;
      if (heading) w(`  --font-heading: ${fontStack(heading)};`);
    }
  }
  w("}");

  // ---- type classes -------------------------------------------------------
  if (groups.length) {
    w();
    w("/* Type scale. One class per named style from the type groups. */");
    for (const group of groups) {
      const fam = group.family;
      w();
      w(`/* ${group.name} — ${fam} */`);
      for (const s of group.styles) {
        w(`.${typePrefix}${s.name} {`);
        w(`  font-family: ${fontStack(fam)};`);
        w(`  font-size: ${s.fontSize};`);
        w(`  line-height: ${s.lineHeight};`);
        if (s.letterSpacing) w(`  letter-spacing: ${s.letterSpacing};`);
        w(`  font-weight: ${s.fontWeight};`);
        if (s.transform) w(`  text-transform: ${s.transform};`);
        w("}");
      }
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, L.join("\n") + "\n");

  const typeCount = groups.reduce((n, g) => n + g.styles.length, 0);
  console.log(`wrote ${outPath.slice(ROOT.length + 1)}`);
  console.log(
    `  ${primitives.length} primitive · ${semantic.length} semantic · ` +
      SCALAR_FAMILIES.map((f) => `${scalars[f].length} ${f}`).join(" · ") +
      ` · ${shadows.length} shadow`,
  );
  console.log(
    `  themes: ${themes.join(", ")} · ${Object.keys(SHADCN_MAP).length} shadcn vars · ` +
      `${semantic.length + Object.keys(ALIAS_COLORS).length} colour utilities · ` +
      `${typeCount} type classes`,
  );
}

// Run when invoked directly; ds-validate imports the mapping above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
