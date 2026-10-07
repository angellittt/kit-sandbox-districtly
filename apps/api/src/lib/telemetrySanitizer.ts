import redact from "@pinojs/redact";

// Generic redaction helper for whatever error-tracking/telemetry client a
// project wires up later (e.g. an error-reporting middleware). Not used by
// default - hook it in wherever request headers/bodies get sent off to a
// third party, so secrets never leave the process.
const SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
];

const SENSITIVE_BODY_FIELDS = [
  "token",
  "refreshToken",
  "accessToken",
  "idToken",
  "password",
  "secret",
  "apiKey",
];

// Bodies can nest sensitive fields a few levels deep (e.g. `user.credentials.token`),
// so redact each field name at the top level and a couple of levels of wildcard nesting.
const MAX_BODY_REDACT_DEPTH = 3;

const SENSITIVE_BODY_PATHS = SENSITIVE_BODY_FIELDS.flatMap((field) =>
  Array.from({ length: MAX_BODY_REDACT_DEPTH }, (_, depth) =>
    [...Array(depth).fill("*"), field].join("."),
  ),
);

const MAX_PROPERTY_LENGTH = 4096;

const serialize = (value: unknown): string => {
  const json = JSON.stringify(value) ?? "";
  return json.length > MAX_PROPERTY_LENGTH
    ? `${json.slice(0, MAX_PROPERTY_LENGTH)}...[truncated]`
    : json;
};

export const sanitizeHeadersForTelemetry = redact({
  paths: SENSITIVE_HEADERS,
  serialize,
}) as (headers: Record<string, unknown>) => string;

export const sanitizeBodyForTelemetry = redact({
  paths: SENSITIVE_BODY_PATHS,
  serialize,
}) as (body: unknown) => string;
