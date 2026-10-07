import { ServerConfig } from "../types/index.js";

const SUPPORTED_ENVS: ServerConfig["env"][] = [
  "development",
  "test",
  "staging",
  "production",
];

/**
 * Reads a required environment variable, throwing a clear error if it's
 * missing. Use this convention for any env var a project adds later
 * (API keys, connection strings, etc.) instead of reading `process.env`
 * ad hoc across the codebase.
 */
export const requiredEnv = (name: string): string => {
  // eslint-disable-next-line security/detect-object-injection
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Environment variable "${name}" is required but not defined.`,
    );
  }
  return value;
};

const parseEnv = (): ServerConfig["env"] => {
  const env = process.env.NODE_ENV ?? "development";
  if (!SUPPORTED_ENVS.includes(env as ServerConfig["env"])) {
    throw new Error(
      `"${env}" is not a valid environment. Supported values are: ${SUPPORTED_ENVS.join(", ")}.`,
    );
  }
  return env as ServerConfig["env"];
};

/**
 * Typed loader for server config sourced from environment variables.
 * Extend this (and `ServerConfig`) as a project adds env vars it needs -
 * required ones should go through `requiredEnv` so a missing value fails
 * fast with a readable error instead of surfacing as `undefined` deep in
 * the app.
 */
export const getServerConfigFromEnvVars = (): ServerConfig => {
  const envPort =
    process.env.PORT !== undefined ? Number(process.env.PORT) : NaN;
  const port = Number.isFinite(envPort) ? envPort : 8000;
  const host = process.env.HOST ?? "0.0.0.0";

  return {
    port,
    host,
    env: parseEnv(),
  };
};
