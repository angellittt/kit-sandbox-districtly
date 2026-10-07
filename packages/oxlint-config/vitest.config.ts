import { baseConfig } from "@repo/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

const config = defineConfig({
  test: {
    exclude: ["node_modules"],
  },
});

export default mergeConfig(baseConfig, config);
