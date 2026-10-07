import pino from "pino";
import { ServerConfig } from "../types/index.js";

export const getLogLevel = (env: ServerConfig["env"]): pino.LevelWithSilent => {
  switch (env) {
    case "development":
      return "debug";
    case "test":
      return "silent";
    default:
      return "info";
  }
};

export const loggerOptions: pino.LoggerOptions = {
  level: getLogLevel(
    (process.env.NODE_ENV as ServerConfig["env"]) ?? "development",
  ),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["set-cookie"]',
      'req.headers["x-api-key"]',
    ],
    censor: "[REDACTED]",
  },
};

export const logger = pino(loggerOptions);
