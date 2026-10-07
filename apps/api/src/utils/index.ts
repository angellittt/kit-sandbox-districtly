import { Server } from "http";
import net from "net";

/**
 * Returns the address of the given HTTP server as a string.
 *
 * @param server - The HTTP server instance.
 * @returns The address string in the format "http://address:port".
 * @throws If the server has no address.
 */
export const getAddress = (server: Server) => {
  const address = server.address();
  if (!address) throw new Error("Server has no address");
  const protocol = "http://";
  if (typeof address === "object") {
    return `${protocol}${address.address}:${address.port}`;
  }
  return `${protocol}${address}`;
};

/**
 * Checks if a given port is available on the specified host.
 * Throws an error if the port is not available.
 *
 * @param port - The port number to check.
 * @param host - The host to check the port on (e.g. '127.0.0.1').
 * @returns Promise<boolean> Resolves to true if port is available, rejects otherwise.
 * @throws Error if the port is not available.
 */
export const checkPortAvailable = async (port: number, host: string) => {
  return new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err) => {
      server.close();
      reject(new Error(`Port ${port} is not available: ${err.message}`));
    });
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, host);
  });
};

/**
 * Gracefully closes the given HTTP server and waits until it is fully closed.
 *
 * @param server - The HTTP server instance.
 * @returns Promise<void> Resolves when the server is closed.
 */
export const closeServer = async (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
