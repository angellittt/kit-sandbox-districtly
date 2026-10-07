import { RequestHandler } from "express";

export const getHealthcheck: RequestHandler = (_, res) => {
  return res
    .status(200)
    .send({ status: "OK", uptime: process.uptime(), timestamp: Date.now() });
};
