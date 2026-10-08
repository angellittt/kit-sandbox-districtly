import { uiConfig } from "@repo/vitest-config/ui";
import { mergeConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import svgr from "vite-plugin-svgr";

export default mergeConfig(uiConfig, {
  // svgr() mirrors vite.config.ts so `*.svg?react` imports resolve the same
  // way under test as they do at build/dev time.
  plugins: [tsconfigPaths(), svgr()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/tests/setup.ts",
    exclude: ["dist", "node_modules", "scripts/__fixtures__/**"],
  },
});
