import { afterAll, beforeAll } from "vitest";
import { closeTestingServer, startTestingServer } from "./utils.js";

// Started here (in-process, per worker), not in globalSetup.ts, so the
// route/controller code it exercises is instrumented for coverage.
beforeAll(async () => {
  await startTestingServer();
});

afterAll(async () => {
  await closeTestingServer();
});
