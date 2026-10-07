import { ErrorRequestHandler } from "express";
import status from "http-status";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "../errors/index.js";

// Maps the typed domain errors in errors/index.ts to HTTP responses, so
// controllers can just `throw new NotFoundError(...)` instead of building
// res.status(...).json(...) by hand. Register this after routes and before
// any catch-all error handler.
export const domainErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  next,
) => {
  if (err instanceof BadRequestError) {
    return res
      .status(status.BAD_REQUEST)
      .json({ error: "Bad Request", message: err.message });
  }

  if (err instanceof ConflictError) {
    return res
      .status(status.CONFLICT)
      .json({ error: "Conflict", message: err.message });
  }

  if (err instanceof ForbiddenError) {
    return res
      .status(status.FORBIDDEN)
      .json({ error: "Forbidden", message: err.message });
  }

  if (err instanceof NotFoundError) {
    return res.status(status.NOT_FOUND).json({
      error: "Not Found",
      message: err.message,
      ...(err.type && { type: err.type }),
    });
  }

  if (err instanceof UnprocessableEntityError) {
    return res
      .status(status.UNPROCESSABLE_ENTITY)
      .json({ error: "Unprocessable Entity", message: err.message });
  }

  next(err);
  return;
};
