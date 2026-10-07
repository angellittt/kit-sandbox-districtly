import { describe, expect, it } from "vitest";

// Proves .env.test is actually loaded by Vite/Vitest (mode defaults to
// "test" under vitest) rather than just sitting there undocumented.
describe("env", () => {
  it("loads VITE_API_BASE_URL from .env.test", () => {
    expect(import.meta.env.VITE_API_BASE_URL).toBe("http://localhost:8000/api");
  });
});
