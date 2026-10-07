import { describe, test, expect } from "vitest";
import { paginationQuerySchema } from "../common.js";

describe("paginationQuerySchema", () => {
  test("defaults page and limit when omitted", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  test("coerces string query params to numbers", () => {
    expect(paginationQuerySchema.parse({ page: "2", limit: "5" })).toEqual({
      page: 2,
      limit: 5,
    });
  });

  test("rejects a limit above the max", () => {
    expect(() => paginationQuerySchema.parse({ limit: "101" })).toThrow();
  });

  test("rejects a page below 1", () => {
    expect(() => paginationQuerySchema.parse({ page: "0" })).toThrow();
  });
});
