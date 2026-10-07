import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// runs a clean after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});

beforeAll(() => {
  console.log("Starting web tests...");
});

afterAll(() => {
  console.log("Web tests finished");
});
