import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getServerConfigFromEnvVars, requiredEnv } from "../index.js";

describe("getServerConfigFromEnvVars", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test("defaults port, host, and env when unset", () => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.NODE_ENV;

    expect(getServerConfigFromEnvVars()).toEqual({
      port: 8000,
      host: "0.0.0.0",
      env: "development",
    });
  });

  test("reads port, host, and env from the environment", () => {
    process.env.PORT = "3000";
    process.env.HOST = "127.0.0.1";
    process.env.NODE_ENV = "staging";

    expect(getServerConfigFromEnvVars()).toEqual({
      port: 3000,
      host: "127.0.0.1",
      env: "staging",
    });
  });

  test("throws for an unsupported NODE_ENV value", () => {
    process.env.NODE_ENV = "not-a-real-env";
    expect(() => getServerConfigFromEnvVars()).toThrow(
      /is not a valid environment/,
    );
  });
});

describe("requiredEnv", () => {
  const ENV_VAR = "SOME_REQUIRED_VAR";

  beforeEach(() => {
    Reflect.deleteProperty(process.env, ENV_VAR);
  });

  test("returns the value when set", () => {
    // eslint-disable-next-line security/detect-object-injection
    process.env[ENV_VAR] = "value";
    expect(requiredEnv(ENV_VAR)).toBe("value");
  });

  test("throws when unset", () => {
    expect(() => requiredEnv(ENV_VAR)).toThrow(/is required but not defined/);
  });

  test("throws when set to an empty string", () => {
    // eslint-disable-next-line security/detect-object-injection
    process.env[ENV_VAR] = "";
    expect(() => requiredEnv(ENV_VAR)).toThrow(/is required but not defined/);
  });
});
