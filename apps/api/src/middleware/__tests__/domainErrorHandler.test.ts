import { describe, test, expect, vi } from "vitest";
import status from "http-status";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "../../errors/index.js";
import { domainErrorHandler } from "../domainErrorHandler.js";

const mockRes = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as import("express").Response;
};

describe("domainErrorHandler", () => {
  test.each([
    [new BadRequestError("bad"), status.BAD_REQUEST, "Bad Request"],
    [new ConflictError("conflict"), status.CONFLICT, "Conflict"],
    [new ForbiddenError("forbidden"), status.FORBIDDEN, "Forbidden"],
    [new NotFoundError("missing"), status.NOT_FOUND, "Not Found"],
    [
      new UnprocessableEntityError("nope"),
      status.UNPROCESSABLE_ENTITY,
      "Unprocessable Entity",
    ],
  ])("maps %o to status %i", (err, expectedStatus, expectedError) => {
    const res = mockRes();
    const next = vi.fn();

    domainErrorHandler(err, {} as import("express").Request, res, next);

    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expectedError, message: err.message }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("includes the type on NotFoundError when present", () => {
    const res = mockRes();
    const next = vi.fn();

    domainErrorHandler(
      new NotFoundError("missing", "Widget"),
      {} as import("express").Request,
      res,
      next,
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: "Widget" }),
    );
  });

  test("delegates unknown errors to the next handler", () => {
    const res = mockRes();
    const next = vi.fn();
    const err = new Error("unexpected");

    domainErrorHandler(err, {} as import("express").Request, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });
});
