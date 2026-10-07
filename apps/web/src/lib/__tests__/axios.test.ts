import { describe, test, expect, vi, afterEach } from "vitest";
import {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from "axios";
import axios, {
  configureAuthTokenSource,
  resetAuthTokenSource,
  type AuthTokenSource,
} from "../axios";

const makeAuthTokenSource = (
  overrides: Partial<AuthTokenSource> = {},
): AuthTokenSource => ({
  getAccessToken: () => undefined,
  getRefreshToken: () => undefined,
  refreshTokens: vi.fn(),
  onRefreshSuccess: vi.fn(),
  onRefreshFailure: vi.fn(),
  ...overrides,
});

const okResponse = (config: InternalAxiosRequestConfig) => ({
  data: {},
  status: 200,
  statusText: "OK",
  headers: {},
  config,
});

const unauthorizedError = (config: InternalAxiosRequestConfig) =>
  new AxiosError("Unauthorized", "ERR_BAD_REQUEST", config, undefined, {
    data: {},
    status: 401,
    statusText: "Unauthorized",
    headers: {},
    config,
  });

describe("axios", () => {
  afterEach(() => {
    resetAuthTokenSource();
    axios.defaults.adapter = undefined;
  });

  test("attaches the access token to outgoing requests without one", async () => {
    configureAuthTokenSource(
      makeAuthTokenSource({ getAccessToken: () => "access-token" }),
    );
    const adapter: AxiosAdapter = vi.fn((config) =>
      Promise.resolve(okResponse(config)),
    );
    axios.defaults.adapter = adapter;

    await axios.get("/ping");

    const sentConfig = (adapter as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentConfig.headers["Authorization"]).toBe("Bearer access-token");
  });

  test("does not overwrite an explicitly set Authorization header", async () => {
    configureAuthTokenSource(
      makeAuthTokenSource({ getAccessToken: () => "access-token" }),
    );
    const adapter: AxiosAdapter = vi.fn((config) =>
      Promise.resolve(okResponse(config)),
    );
    axios.defaults.adapter = adapter;

    await axios.get("/ping", {
      headers: { Authorization: "Bearer explicit" },
    });

    const sentConfig = (adapter as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentConfig.headers["Authorization"]).toBe("Bearer explicit");
  });

  test("passes through a non-401 error untouched", async () => {
    configureAuthTokenSource(makeAuthTokenSource());
    const adapter: AxiosAdapter = vi.fn(() =>
      Promise.reject(new AxiosError("Server error")),
    );
    axios.defaults.adapter = adapter;

    await expect(axios.get("/boom")).rejects.toThrow("Server error");
  });

  test("passes through a 401 unretried when there's no refresh token", async () => {
    const onRefreshFailure = vi.fn();
    configureAuthTokenSource(
      makeAuthTokenSource({
        getRefreshToken: () => undefined,
        onRefreshFailure,
      }),
    );
    const adapter: AxiosAdapter = vi.fn((config) =>
      Promise.reject(unauthorizedError(config)),
    );
    axios.defaults.adapter = adapter;

    await expect(axios.get("/secret")).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(onRefreshFailure).not.toHaveBeenCalled();
  });

  test("refreshes once and retries concurrent 401s with the new token", async () => {
    const refreshTokens = vi.fn().mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    const onRefreshSuccess = vi.fn();
    configureAuthTokenSource(
      makeAuthTokenSource({
        getAccessToken: () => "expired-access",
        getRefreshToken: () => "refresh-token",
        refreshTokens,
        onRefreshSuccess,
      }),
    );
    const adapter: AxiosAdapter = vi.fn((config) => {
      if ((config as { _retry?: boolean })._retry) {
        return Promise.resolve(okResponse(config));
      }
      return Promise.reject(unauthorizedError(config));
    });
    axios.defaults.adapter = adapter;

    const [a, b] = await Promise.all([axios.get("/one"), axios.get("/two")]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(refreshTokens).toHaveBeenCalledWith("refresh-token");
    expect(onRefreshSuccess).toHaveBeenCalledWith({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    // 2 original requests + 2 retries once refreshed = 4 adapter calls.
    expect(adapter).toHaveBeenCalledTimes(4);
    expect(a.config.headers["Authorization"] as string).toBe(
      "Bearer new-access",
    );
    expect(b.config.headers["Authorization"] as string).toBe(
      "Bearer new-access",
    );
  });

  test("reports refresh failure and rejects with the original error", async () => {
    const refreshError = new Error("refresh token expired");
    const onRefreshFailure = vi.fn();
    configureAuthTokenSource(
      makeAuthTokenSource({
        getRefreshToken: () => "refresh-token",
        refreshTokens: vi.fn().mockRejectedValue(refreshError),
        onRefreshFailure,
      }),
    );
    const adapter: AxiosAdapter = vi.fn((config) =>
      Promise.reject(unauthorizedError(config)),
    );
    axios.defaults.adapter = adapter;

    await expect(axios.get("/secret")).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(onRefreshFailure).toHaveBeenCalledTimes(1);
  });

  test("reports refresh failure once for concurrent 401s sharing the refresh", async () => {
    const refreshError = new Error("refresh token expired");
    const onRefreshFailure = vi.fn();
    configureAuthTokenSource(
      makeAuthTokenSource({
        getRefreshToken: () => "refresh-token",
        refreshTokens: vi.fn().mockRejectedValue(refreshError),
        onRefreshFailure,
      }),
    );
    const adapter: AxiosAdapter = vi.fn((config) =>
      Promise.reject(unauthorizedError(config)),
    );
    axios.defaults.adapter = adapter;

    const results = await Promise.allSettled([
      axios.get("/one"),
      axios.get("/two"),
    ]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    expect(onRefreshFailure).toHaveBeenCalledTimes(1);
  });
});
