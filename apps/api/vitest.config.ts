import { baseConfig } from "@repo/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

const config = defineConfig({
  test: {
    globalSetup: "./src/tests/globalSetup.ts",
    setupFiles: "./src/tests/setupFiles.ts",
    exclude: ["dist", "node_modules"],
    coverage: {
      clean: false,
    },
  },
});

export default mergeConfig(baseConfig, config);
