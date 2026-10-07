import { Router } from "express";
import { getHealthcheck } from "../controllers/healthcheck.js";

export const healthcheckRouter: Router = Router();

healthcheckRouter.get("/", getHealthcheck);
