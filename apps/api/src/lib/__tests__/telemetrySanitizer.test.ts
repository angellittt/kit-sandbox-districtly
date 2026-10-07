import { describe, test, expect } from "vitest";
import {
  sanitizeHeadersForTelemetry,
  sanitizeBodyForTelemetry,
} from "../telemetrySanitizer.js";

describe("sanitizeHeadersForTelemetry", () => {
  test("redacts sensitive headers", () => {
    const result = sanitizeHeadersForTelemetry({
      authorization: "Bearer token",
      cookie: "session=abc",
      "set-cookie": "session=abc",
      "proxy-authorization": "Basic abc",
      "x-api-key": "secret",
    });

    expect(JSON.parse(result)).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "set-cookie": "[REDACTED]",
      "proxy-authorization": "[REDACTED]",
      "x-api-key": "[REDACTED]",
    });
  });

  test("leaves non-sensitive headers untouched", () => {
    const result = sanitizeHeadersForTelemetry({
      "user-agent": "vitest",
      accept: "application/json",
    });

    expect(JSON.parse(result)).toEqual({
      "user-agent": "vitest",
      accept: "application/json",
    });
  });

  test("truncates the serialized output once it exceeds the max length", () => {
    const result = sanitizeHeadersForTelemetry({
      "x-large": "x".repeat(5000),
    });

    expect(result.length).toBeLessThan(
      JSON.stringify({ "x-large": "x".repeat(5000) }).length,
    );
    expect(result.endsWith("...[truncated]")).toBe(true);
  });
});

describe("sanitizeBodyForTelemetry", () => {
  test("serializes the body as-is when under the size limit", () => {
    const body = { name: "Fullstack Starter" };

    expect(sanitizeBodyForTelemetry(body)).toBe(JSON.stringify(body));
  });

  test("truncates a body that exceeds the max length", () => {
    const body = { blob: "x".repeat(5000) };
    const result = sanitizeBodyForTelemetry(body);

    expect(result.length).toBeLessThan(JSON.stringify(body).length);
    expect(result.endsWith("...[truncated]")).toBe(true);
  });

  test("handles a bodyless request without throwing", () => {
    expect(sanitizeBodyForTelemetry(undefined)).toBe("");
  });

  test("redacts sensitive fields like tokens and passwords", () => {
    const result = sanitizeBodyForTelemetry({
      refreshToken: "super-secret",
      token: "magic-link-jwt",
      password: "hunter2",
      email: "a@b.com",
    });

    expect(JSON.parse(result)).toEqual({
      refreshToken: "[REDACTED]",
      token: "[REDACTED]",
      password: "[REDACTED]",
      email: "a@b.com",
    });
  });

  test("redacts sensitive fields nested inside the body", () => {
    const result = sanitizeBodyForTelemetry({
      user: { credentials: { token: "deep-token" } },
      ok: "fine",
    });

    expect(JSON.parse(result)).toEqual({
      user: { credentials: { token: "[REDACTED]" } },
      ok: "fine",
    });
  });
});
