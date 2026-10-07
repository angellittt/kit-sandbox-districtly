import { defineConfig, devices } from "@playwright/test";

// Single worker: e2e/support/utils.ts seeds/clears shared fixture data via
// the API, and running specs in parallel would race each other over it.
// Bump this once specs are isolated enough to run concurrently.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Fail CI if a test.only is committed; vitest/no-focused-tests doesn't
  // recognize Playwright's test.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  globalSetup: "./e2e/support/globalSetup.ts",
  globalTeardown: "./e2e/support/globalTeardown.ts",
  use: {
    // Set by docker-compose-e2e.yml to point at the containerized web
    // service; falls back to a local dev server for running outside Docker
    // (see scripts/e2e-ui.sh).
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
