import { definePlugin } from "@oxlint/plugins";
import { noDirectAxios } from "./rules/no-direct-axios.ts";

/**
 * Custom lint rules for this repo's conventions. Loaded by oxlint through
 * `jsPlugins` in an .oxlintrc.json; rules are named `repo/<rule-name>`.
 * See "Writing a custom lint rule" in the Readme.
 */
export default definePlugin({
  meta: { name: "repo" },
  rules: {
    "no-direct-axios": noDirectAxios,
  },
});
