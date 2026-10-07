import { z } from "zod";

export const DEFAULT_REQUIRED_FIELD_ERROR_MESSAGE = "This field is required";

// Global Zod error map - normalizes "required field" messages everywhere,
// instead of every schema repeating its own copy. Import this once (e.g. in
// main.tsx) before any schema is used, so z.config() takes effect globally.
z.config({
  customError: (issue) => {
    // Catches empty strings: z.string().min(1) on a blank input
    if (
      issue.code === "too_small" &&
      issue.minimum === 1 &&
      issue.origin === "string"
    ) {
      return { message: DEFAULT_REQUIRED_FIELD_ERROR_MESSAGE };
    }

    // Catches missing values: required fields left as undefined/null
    if (issue.code === "invalid_type" && issue.input == null) {
      return { message: DEFAULT_REQUIRED_FIELD_ERROR_MESSAGE };
    }

    // Fall back to Zod's default or any per-field message (e.g. "Invalid email address")
    return undefined;
  },
});
