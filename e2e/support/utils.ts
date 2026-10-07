/**
 * Base URL for the API under test. Used to seed/clear fixture data over
 * HTTP (see below) rather than by touching a database directly, so this
 * suite stays agnostic to whichever db/ORM a project ends up adding.
 */
export const API_URL = process.env.API_URL ?? "http://localhost:8000";

/**
 * Seeds whatever test data your e2e specs rely on, by calling a
 * project-specific API endpoint. This template ships with no such
 * endpoint - add one once a project has data worth seeding (e.g. `POST
 * /api/v1/test/seed`, gated to only exist when NODE_ENV === "test") and
 * call it here.
 */
export const seedTestData = async (): Promise<void> => {
  // await fetch(`${API_URL}/api/v1/test/seed`, { method: "POST" });
};

/**
 * Clears whatever test data `seedTestData` created above. Same slot as
 * above - wire this up once your project has a seed/clear endpoint.
 */
export const clearTestData = async (): Promise<void> => {
  // await fetch(`${API_URL}/api/v1/test/clear`, { method: "POST" });
};
