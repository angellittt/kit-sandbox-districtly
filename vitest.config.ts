import { defineConfig } from "vitest/config";
import { baseConfig } from "@repo/vitest-config";

export default defineConfig({
  ...baseConfig,
  test: {
    projects: [
      "apps/*",
      {
        root: "./packages",
        test: {
          ...baseConfig.test,
          exclude: ["**/dist/**", "**/node_modules/**"],
        },
      },
    ],
    // Only used for an ad-hoc `vitest run --coverage` from the repo root.
    // The documented flows (`test`, `test:projects`, `test:report`) don't pass
    // `--coverage`, so this block doesn't run during them; per-package
    // coverage collection during `turbo run test` comes from `baseConfig` in
    // `packages/vitest-config` instead.
    coverage: {
      provider: "istanbul",
      reporter: ["json-summary", "html"],
    },
  },
});
