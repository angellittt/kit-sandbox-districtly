// Guards against tests accidentally running (and mutating/wiping data) against
// a non-test database. This template ships without a database/ORM, so nothing
// calls this yet - wire it into your test globalSetup once a project adds one,
// pointing `name` at whichever env var holds the connection string
// (e.g. "DATABASE_URL").
export const assertTestDatabase = (name: string): void => {
  // eslint-disable-next-line security/detect-object-injection
  const connectionString = process.env[name] ?? "";
  if (!connectionString.includes("test")) {
    throw new Error(
      `The provided ${name} does not seem to be a testing database.`,
    );
  }
};
