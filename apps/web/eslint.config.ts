import reactEslintConfig from "@repo/eslint-config/eslint.react.config";
import { disableRulesCoveredByOxlint } from "@repo/eslint-config/oxlint";
import { defineConfig, globalIgnores } from "eslint/config";
import type { Linter } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";

// ---- design-system-kit (vendored files keep stock shadcn's style) ----------
// Files the kit vendors: stock components, kept as shadcn ships them, and the
// two stock helpers outside the component folder. App-owned files the kit only
// seeds (src/lib/locale.ts) aren't here — the app's style applies to them.
const DS_VENDORED = [
  "src/components/ui/**",
  "src/components/theme-provider.tsx",
  "src/hooks/use-mobile.ts",
];
// Rules from these plugins stay on everywhere: accessibility and hooks.
const DS_ALWAYS_ON = new Set(["jsx-a11y", "react-hooks"]);

// The repo's style rules — those ESLint itself types "layout" or "suggestion"
// (prefer-arrow-functions, import-x/order) — off for the vendored files only.
// Correctness ("problem") rules stay on. Only rules the repo turns on are named.
// (Maps rather than object lookups, so a repo's security rules don't flag it.)
type DsRule = { meta?: { type?: string } };
const dsStyleRulesOff = (entries: Linter.Config[]): Linter.Config => {
  const plugins = new Map<string, Map<string, DsRule>>();
  for (const e of entries) {
    for (const [name, plugin] of Object.entries(e.plugins ?? {})) {
      plugins.set(
        name,
        new Map(
          Object.entries(
            (plugin as { rules?: Record<string, DsRule> }).rules ?? {},
          ),
        ),
      );
    }
  }
  const on = new Set<string>();
  for (const e of entries) {
    for (const [id, setting] of Object.entries(e.rules ?? {})) {
      const level = Array.isArray(setting) ? setting[0] : setting;
      if (level === "off" || level === 0) on.delete(id);
      else on.add(id);
    }
  }
  const style = [...on].filter((id) => {
    const slash = id.lastIndexOf("/");
    const plugin = slash === -1 ? null : id.slice(0, slash);
    if (plugin && DS_ALWAYS_ON.has(plugin)) return false;
    const type = plugin
      ? plugins.get(plugin)?.get(id.slice(slash + 1))?.meta?.type
      : builtinRules.get(id)?.meta?.type;
    return type === "layout" || type === "suggestion";
  });
  return {
    files: DS_VENDORED,
    rules: Object.fromEntries(style.map((id) => [id, "off"])),
  };
};

const withDesignSystem = (entries: Linter.Config[]): Linter.Config[] => [
  ...entries,
  // Vendored components carry disable comments for other configs' rules
  // (react-hooks/exhaustive-deps); a repo that doesn't enable them would report
  // the comments as unused.
  {
    files: ["src/components/ui/**"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  dsStyleRulesOff(entries),
  // The kit files a repo carries for its CI check are linted in the kit.
  { ignores: ["scripts/ds-validate.mjs", "scripts/ds-drift.test.mjs"] },
];
// ---- end design-system-kit -------------------------------------------------

export default defineConfig(
  withDesignSystem([
    // Flat config doesn't read .gitignore. Vitest rewrites coverage/ and turbo
    // writes .turbo/ while lint runs alongside them, so walking either can race.
    globalIgnores(["coverage", ".turbo"]),
    ...reactEslintConfig,
    {
      rules: {
        "import-x/no-unresolved": [
          "error",
          {
            /* Ignoring absolute import paths because we couldn't figure out how to make it work with eslint
             * Created a ticket for this: https://app.clickup.com/t/8593845/HAND_INT-552
             */
            ignore: ["^@/"],
          },
        ],
      },
    },
    ...disableRulesCoveredByOxlint(`${import.meta.dirname}/.oxlintrc.json`),
  ]),
);
