import type { Linter } from "eslint";
import oxlint from "eslint-plugin-oxlint";

/**
 * Turns off every ESLint rule that oxlint already runs, so each rule runs
 * once. Pass the package's .oxlintrc.json (its `extends` are followed).
 * Put it last in the config array so nothing turns those rules back on.
 */
export const disableRulesCoveredByOxlint = (
  oxlintConfigFile: string,
): Linter.Config[] =>
  oxlint.buildFromOxlintConfigFile(oxlintConfigFile).map((config) => ({
    ...config,
    // eslint-plugin-oxlint names import rules `import/*`, but this repo
    // registers eslint-plugin-import-x, whose rules are `import-x/*`.
    rules: Object.fromEntries(
      Object.entries(config.rules ?? {}).map(([name, value]) => [
        name.replace(/^import\//, "import-x/"),
        value,
      ]),
    ),
  }));
