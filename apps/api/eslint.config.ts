import baseEslintConfig from "@repo/eslint-config/eslint.base.config";
import { disableRulesCoveredByOxlint } from "@repo/eslint-config/oxlint";
import { defineConfig } from "eslint/config";
export default defineConfig([
  ...baseEslintConfig,
  ...disableRulesCoveredByOxlint(`${import.meta.dirname}/.oxlintrc.json`),
]);
