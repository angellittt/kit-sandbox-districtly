import reactEslintConfig from "@repo/eslint-config/eslint.react.config";
import { disableRulesCoveredByOxlint } from "@repo/eslint-config/oxlint";
import { defineConfig } from "eslint/config";
export default defineConfig([
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
]);
