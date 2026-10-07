import { describe, test, expect, afterEach } from "vitest";
import { assertTestDatabase } from "../assertTestDatabase.js";

const ENV_VAR = "SOME_DATABASE_URL";

describe("assertTestDatabase", () => {
  afterEach(() => {
    Reflect.deleteProperty(process.env, ENV_VAR);
  });

  test("throws when the env var is unset", () => {
    expect(() => assertTestDatabase(ENV_VAR)).toThrow(
      /does not seem to be a testing database/,
    );
  });

  test("throws when the connection string doesn't mention 'test'", () => {
    // eslint-disable-next-line security/detect-object-injection
    process.env[ENV_VAR] = "postgres://localhost:5432/production";
    expect(() => assertTestDatabase(ENV_VAR)).toThrow(
      /does not seem to be a testing database/,
    );
  });

  test("passes when the connection string mentions 'test'", () => {
    // eslint-disable-next-line security/detect-object-injection
    process.env[ENV_VAR] = "postgres://localhost:5432/app_test";
    expect(() => assertTestDatabase(ENV_VAR)).not.toThrow();
  });
});
