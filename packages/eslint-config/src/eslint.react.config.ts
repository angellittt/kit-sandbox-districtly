import { defineConfig } from "eslint/config";
import baseConfig from "./eslint.base.config.js";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/* React, JSX a11y and React Refresh rules run in oxlint (see
 * packages/oxlint-config/react.json). ESLint keeps react-hooks only for the
 * few React Compiler rules oxlint doesn't have yet (config, gating,
 * component-hook-factories).
 */
export default defineConfig([
  ...baseConfig,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  eslintConfigPrettier, // This plugin must always be last so it gets the chance to override other configs.
]);
