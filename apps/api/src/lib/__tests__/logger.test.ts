import { describe, test, expect } from "vitest";
import pino from "pino";
import { getLogLevel, loggerOptions } from "../logger.js";

describe("getLogLevel", () => {
  test("returns debug for development", () => {
    expect(getLogLevel("development")).toBe("debug");
  });

  test("returns silent for test", () => {
    expect(getLogLevel("test")).toBe("silent");
  });

  test("returns info for staging and production", () => {
    expect(getLogLevel("staging")).toBe("info");
    expect(getLogLevel("production")).toBe("info");
  });
});

describe("logger redaction", () => {
  test("redacts sensitive headers from logged request objects", () => {
    const lines: string[] = [];
    const testLogger = pino(
      { ...loggerOptions, level: "info" },
      { write: (msg: string) => lines.push(msg) },
    );

    testLogger.info(
      {
        req: {
          headers: {
            authorization: "Bearer super-secret-token",
            cookie: "session=abc123",
            "set-cookie": "session=abc123; HttpOnly",
            "x-api-key": "sk-secret",
            "user-agent": "vitest",
          },
        },
      },
      "incoming request",
    );

    const logged = JSON.parse(lines[0]);
    expect(logged.req.headers.authorization).toBe("[REDACTED]");
    expect(logged.req.headers.cookie).toBe("[REDACTED]");
    expect(logged.req.headers["set-cookie"]).toBe("[REDACTED]");
    expect(logged.req.headers["x-api-key"]).toBe("[REDACTED]");
    expect(logged.req.headers["user-agent"]).toBe("vitest");
  });
});
