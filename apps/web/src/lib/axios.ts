import Axios, {
  AxiosError,
  type AxiosRequestHeaders,
  type InternalAxiosRequestConfig,
} from "axios";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * This template has no opinion on how auth ends up being implemented (a
 * Zustand store, React context, cookies, ...), so the token lifecycle is a
 * pluggable slot instead of a hardcoded import. Wire it up once a project
 * has a real auth store, e.g.:
 *
 *   import { useAuthStore } from "@/auth/store";
 *   configureAuthTokenSource({
 *     getAccessToken: () => useAuthStore.getState().accessToken,
 *     getRefreshToken: () => useAuthStore.getState().refreshToken,
 *     refreshTokens: (refreshToken) =>
 *       axios.post("/auth/refresh", { refreshToken }).then((res) => res.data),
 *     onRefreshSuccess: (tokens) => useAuthStore.getState().save(tokens),
 *     onRefreshFailure: () => useAuthStore.getState().clear(),
 *   });
 *
 * Until a project configures one, every request goes out without an
 * Authorization header and a 401 is passed straight through unretried.
 */
export interface AuthTokenSource {
  getAccessToken: () => string | null | undefined;
  getRefreshToken: () => string | null | undefined;
  refreshTokens: (refreshToken: string) => Promise<AuthTokens>;
  onRefreshSuccess: (tokens: AuthTokens) => void;
  onRefreshFailure: () => void;
}

const noopAuthTokenSource: AuthTokenSource = {
  getAccessToken: () => undefined,
  getRefreshToken: () => undefined,
  refreshTokens: () =>
    Promise.reject(new Error("No auth token source configured")),
  onRefreshSuccess: () => {},
  onRefreshFailure: () => {},
};

let authTokenSource: AuthTokenSource = noopAuthTokenSource;

export const configureAuthTokenSource = (source: AuthTokenSource) => {
  authTokenSource = source;
};

// Exposed so tests can restore the default between cases.
export const resetAuthTokenSource = () => {
  authTokenSource = noopAuthTokenSource;
};

// VITE_API_BASE_URL isn't defined anywhere yet (see ClickUp 868knv3b3, which
// adds .env.example/.env.test) - falling back to "" means requests are
// relative to the current origin until a project sets it.
const axios = Axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "",
});

// Request interceptor: attaches the access token to every outgoing request
// that doesn't already carry its own Authorization header.
const attachAuthHeader = (requestConfig: InternalAxiosRequestConfig) => {
  const token = authTokenSource.getAccessToken();
  let headers = requestConfig.headers as AxiosRequestHeaders | undefined;
  if (!headers) {
    headers = {} as AxiosRequestHeaders;
    requestConfig.headers = headers;
  }
  const hasAuthHeader =
    typeof headers.has === "function"
      ? headers.has("Authorization")
      : typeof headers["Authorization"] !== "undefined";
  if (token && !hasAuthHeader) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return requestConfig;
};

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// Shared in-flight refresh: when several requests 401 at once, they all
// await the same refresh call instead of each firing their own.
let refreshPromise: Promise<AuthTokens> | null = null;

const refreshAccessToken = (refreshToken: string): Promise<AuthTokens> => {
  if (!refreshPromise) {
    refreshPromise = authTokenSource
      .refreshTokens(refreshToken)
      .then((tokens) => {
        authTokenSource.onRefreshSuccess(tokens);
        return tokens;
      })
      .catch((refreshError) => {
        authTokenSource.onRefreshFailure();
        throw refreshError;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

// Response interceptor: on a 401, refreshes the token and retries the
// original request once. Falls through (and reports the failure) if the
// refresh itself fails, or if there's no refresh token to try.
const handleResponseError = async (error: AxiosError) => {
  const originalConfig = error.config as RetryableConfig | undefined;
  const refreshToken = authTokenSource.getRefreshToken();

  if (
    error.response?.status !== 401 ||
    !originalConfig ||
    originalConfig._retry ||
    !refreshToken
  ) {
    return Promise.reject(error);
  }

  originalConfig._retry = true;

  try {
    const { accessToken } = await refreshAccessToken(refreshToken);
    (originalConfig.headers as AxiosRequestHeaders)["Authorization"] =
      `Bearer ${accessToken}`;
    return axios(originalConfig);
  } catch {
    return Promise.reject(error);
  }
};

axios.interceptors.request.use(attachAuthHeader);
axios.interceptors.response.use((response) => response, handleResponseError);

export default axios;
