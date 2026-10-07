import baseEslintConfig from "@repo/eslint-config/eslint.base.config";
import { defineConfig, globalIgnores } from "eslint/config";
export default defineConfig([
  // The tests write a probe and a coverage folder while `pnpm verify` lints in parallel.
  globalIgnores([".tmp-*", "coverage"]),
  ...baseEslintConfig,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
