import { Server } from "http";
import express from "express";
import { pinoHttp } from "pino-http";
import { ServerConfig } from "./types/index.js";
import { checkPortAvailable, getAddress } from "./utils/index.js";
import { apiRouter } from "./routes/index.js";
import { domainErrorHandler } from "./middleware/domainErrorHandler.js";
import { logger } from "./lib/logger.js";

export const createApp = (): express.Express => {
  const app = express();
  // Registered before all routes so every request gets a child logger automatically.
  app.use(pinoHttp({ logger }));
  app.use("/api/v1", apiRouter);
  // Register any project-specific error handlers after this one, and before
  // a catch-all handler that reports genuinely unexpected failures.
  app.use(domainErrorHandler);
  return app;
};

export const startServer = async (config: ServerConfig) => {
  await checkPortAvailable(config.port, config.host);

  const app = createApp();
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(
      config.port,
      config.host,
      async (error?: Error) => {
        if (error) {
          reject(error);
        }
        const address = getAddress(server);
        logger.info(`Ready at ${address}`);
        resolve(server);
      },
    );
  });
};
