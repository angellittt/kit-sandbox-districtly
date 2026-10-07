import express, { Router } from "express";
import cors from "cors";
import { healthcheckRouter } from "./healthcheck.js";

export const apiRouter: Router = Router();

apiRouter.use(cors());
apiRouter.use(express.json({ limit: "10mb" }));
apiRouter.use(
  express.urlencoded({ limit: "10mb", extended: true, parameterLimit: 1000 }),
);

apiRouter.use("/healthcheck", healthcheckRouter);
