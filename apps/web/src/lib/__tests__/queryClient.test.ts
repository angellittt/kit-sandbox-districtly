import { describe, test, expect, vi, afterEach } from "vitest";
import {
  queryClient,
  configureQueryTelemetry,
  resetQueryTelemetry,
} from "../queryClient";

describe("queryClient", () => {
  afterEach(() => {
    resetQueryTelemetry();
    queryClient.clear();
  });

  test("reports failed queries through the configured telemetry hook", async () => {
    const reporter = vi.fn();
    configureQueryTelemetry(reporter);
    const error = new Error("query failed");

    await queryClient
      .fetchQuery({
        queryKey: ["thing", 1],
        queryFn: () => Promise.reject(error),
        retry: false,
      })
      .catch(() => {});

    expect(reporter).toHaveBeenCalledWith(error, {
      type: "query",
      queryKey: ["thing", 1],
    });
  });

  test("reports failed mutations through the configured telemetry hook", async () => {
    const reporter = vi.fn();
    configureQueryTelemetry(reporter);
    const error = new Error("mutation failed");

    const mutation = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => Promise.reject(error) });
    await mutation.execute({}).catch(() => {});

    expect(reporter).toHaveBeenCalledWith(error, { type: "mutation" });
  });

  test("does nothing when no telemetry hook is configured", async () => {
    const error = new Error("query failed");

    await expect(
      queryClient.fetchQuery({
        queryKey: ["unconfigured"],
        queryFn: () => Promise.reject(error),
        retry: false,
      }),
    ).rejects.toThrow("query failed");
  });
});
