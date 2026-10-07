import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";

export type QueryTelemetryContext =
  | { type: "query"; queryKey: unknown }
  | { type: "mutation" };

export type QueryTelemetryReporter = (
  error: unknown,
  context: QueryTelemetryContext,
) => void;

/**
 * This template doesn't wire up a specific telemetry client (App Insights,
 * Sentry, ...), so failed queries/mutations are reported through a
 * pluggable hook instead. Wire one up once a project has a telemetry
 * client, e.g.:
 *
 *   import { configureQueryTelemetry } from "@/lib/queryClient";
 *   configureQueryTelemetry((error, context) =>
 *     telemetryClient.trackException({ exception: error, properties: context }),
 *   );
 *
 * Until then, failed queries/mutations are silently dropped here - they
 * still reject/surface through the usual TanStack Query error states.
 */
let reportQueryTelemetry: QueryTelemetryReporter = () => {};

export const configureQueryTelemetry = (reporter: QueryTelemetryReporter) => {
  reportQueryTelemetry = reporter;
};

// Exposed so tests can restore the default between cases.
export const resetQueryTelemetry = () => {
  reportQueryTelemetry = () => {};
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) =>
      reportQueryTelemetry(error, { type: "query", queryKey: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error) => reportQueryTelemetry(error, { type: "mutation" }),
  }),
});
