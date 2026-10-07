// Runs once, in its own process, before any test file executes. Use this for
// setup that only needs to happen once for the whole test run - e.g.
// migrating/seeding a database - as opposed to setupFiles.ts, which runs
// per test worker.
//
// This template ships without a database/ORM, so there's nothing to do here
// yet. Once a project adds one, a typical implementation looks like:
//
//   import { execSync } from "node:child_process";
//   import { assertTestDatabase } from "../lib/assertTestDatabase.js";
//
//   export const setup = async () => {
//     assertTestDatabase("DATABASE_URL");
//     execSync("pnpm --filter=api db:migrate", { stdio: "inherit" });
//     execSync("pnpm --filter=api db:seed", { stdio: "inherit" });
//   };
//
//   export const teardown = async () => {
//     // e.g. await prisma.$disconnect();
//   };
export const setup = async () => {};

export const teardown = async () => {};
