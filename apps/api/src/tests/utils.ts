import { Server } from "node:http";
import { startServer } from "../app.js";
import { ServerConfig } from "../types/index.js";
import { closeServer, getAddress } from "../utils/index.js";

export const testingConfig: ServerConfig = {
  port: 0, // Using 0 to let the OS assign an available port
  host: "0.0.0.0",
  env: "test",
};

let testServer: Server | undefined = undefined;

// Must start here, not in globalSetup.ts: globalSetup runs in a different
// process that istanbul doesn't track, so coverage would be lost.
export const startTestingServer = async () => {
  if (!testServer) {
    testServer = await startServer(testingConfig);
  }
  return testServer;
};

export const closeTestingServer = async () => {
  if (testServer) {
    await closeServer(testServer);
    testServer = undefined;
  }
};

export const getTestAddress = () => {
  if (!testServer) {
    throw new Error(
      "Test server is not running. Make sure to start the testing server before running tests.",
    );
  }
  return getAddress(testServer);
};
