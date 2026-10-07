import { defineConfig, globalIgnores } from "eslint/config";
import baseEslintConfig from "@repo/eslint-config/eslint.base.config";
import { disableRulesCoveredByOxlint } from "@repo/eslint-config/oxlint";

export default defineConfig([
  // vitest.config.ts isn't included in any workspace tsconfig, so typed
  // linting has no project to resolve it against. Skip it rather than
  // breaking pre-commit lint on a root-level config file.
  globalIgnores(["vitest.config.ts"]),
  ...baseEslintConfig,
  {
    languageOptions: {
      parserOptions: {
        // Disambiguates root-level files (like this one) from workspace
        // tsconfigs (e.g. apps/api), which typescript-eslint otherwise
        // reports as competing candidate roots.
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...disableRulesCoveredByOxlint(`${import.meta.dirname}/.oxlintrc.json`),
]);
