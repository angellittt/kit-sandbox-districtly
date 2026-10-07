import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";
// @ts-expect-error - No types available for eslint-plugin-promise
import pluginPromise from "eslint-plugin-promise";
import turboConfig from "eslint-config-turbo/flat";
// @ts-expect-error - No types available for eslint-plugin-security
import pluginSecurity from "eslint-plugin-security";
import tsParser from "@typescript-eslint/parser";
import { configs as preferArrowFunctionsConfigs } from "eslint-plugin-prefer-arrow-functions";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    // A stale eslint-disable comment hides nothing, but it misleads readers
    // and silently re-enables suppression if the rule comes back.
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  js.configs.recommended,
  preferArrowFunctionsConfigs.all,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- flatConfigs.recommended's languageOptions type conflicts with defineConfig's expected ConfigWithExtends across the @typescript-eslint/utils and @eslint/config-helpers versions in this repo
  importX.flatConfigs.recommended as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- eslint-plugin-security ships no type declarations
  pluginSecurity.configs.recommended as any,
  tseslint.configs.strict,
  /** Include Turborepo's ESLint config to ensure consistency across the monorepo.
   * This config includes rules and settings that are optimized for monorepos and
   * work well with Turborepo's caching and build system.
   * @see https://turborepo.dev/docs/crafting-your-repository/using-environment-variables
   */
  ...turboConfig,
  {
    plugins: {
      promise: pluginPromise,
    },
    files: ["**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          bun: true,
          project: ["packages/*/tsconfig.json", "apps/*/jsconfig.json"],
        }),
      ],
    },
    rules: {
      /* Manually adding promise rules because eslint-plugin-promise is not
       * compatible with ESLint flat config, so the recommended preset cannot
       * be used directly. Defining rules here ensures they are applied correctly.
       */
      "promise/always-return": "error",
      "promise/no-return-wrap": "error",
      "promise/param-names": "error",
      "promise/catch-or-return": "error",
      "promise/no-native": "off",
      "promise/no-nesting": "warn",
      "promise/no-promise-in-callback": "warn",
      "promise/no-callback-in-promise": "warn",
      "promise/avoid-new": "off",
      "promise/no-new-statics": "error",
      "promise/no-return-in-finally": "warn",
      "promise/valid-params": "warn",
      /** Enforce a convention in module import order
       * @see https://github.com/un-ts/eslint-plugin-import-x/blob/master/docs/rules/order.md
       */
      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin", // Node.js modules first
            "external", // npm packages next
            "internal", // internal monorepo or alias packages
            "parent", // ../ imports
            "sibling", // ./ imports
            "index", // ./index files
            "object", // type-only or special TS imports
          ],
        },
      ],
    },
  },
  eslintConfigPrettier, // This plugin must always be last so it gets the chance to override other configs.
]);
