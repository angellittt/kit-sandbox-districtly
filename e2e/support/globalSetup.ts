import { seedTestData } from "./utils.js";

/**
 * Runs once before the whole e2e suite. Seeds fixture data via the API
 * (see utils.ts) instead of assuming a specific db/ORM/auth setup - wire
 * seedTestData() up once a project has a seed endpoint to call.
 */
export default async function globalSetup() {
  await seedTestData();
}
