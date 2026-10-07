import { describe, test, expect } from "vitest";
import { z } from "zod";
import { DEFAULT_REQUIRED_FIELD_ERROR_MESSAGE } from "../zod-error-map";

describe("zod-error-map", () => {
  test("normalizes a blank string on a required field", () => {
    const schema = z.string().min(1);
    const result = schema.safeParse("");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      DEFAULT_REQUIRED_FIELD_ERROR_MESSAGE,
    );
  });

  test("normalizes a missing value on a required field", () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      DEFAULT_REQUIRED_FIELD_ERROR_MESSAGE,
    );
  });

  test("falls back to zod's default message for other issues", () => {
    const schema = z.string().email();
    const result = schema.safeParse("not-an-email");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).not.toBe(
      DEFAULT_REQUIRED_FIELD_ERROR_MESSAGE,
    );
  });

  test("falls back to a per-field custom message", () => {
    const schema = z.string().min(1, { message: "Name is required" });
    const result = schema.safeParse("");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Name is required");
  });
});
