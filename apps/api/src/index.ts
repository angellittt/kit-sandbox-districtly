import { startServer } from "./app.js";
import { getServerConfigFromEnvVars } from "./config/index.js";
import { logger } from "./lib/logger.js";

const main = async () => {
  try {
    const config = getServerConfigFromEnvVars();
    await startServer(config);
  } catch (error) {
    logger.error(error, "Error starting server");
    process.exit(1);
  }
};

main();
