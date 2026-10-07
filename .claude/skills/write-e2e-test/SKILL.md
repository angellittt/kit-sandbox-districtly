---
name: write-e2e-test
description: Guide for writing Playwright E2E tests in this project. Use when the user wants to write, add, or create an end-to-end test, a Playwright test, or simulate a user flow (navigate, interact, assert).
---

# E2E Test Guide

## Project setup

- Config: `playwright.config.ts` — `testDir: ./e2e`, `baseURL` defaults to the web app's local dev URL (overridable via `BASE_URL`, set by `docker-compose-e2e.yml` when running in Docker)
- No auth fixtures ship with this template by default. If the project has added one (check `e2e/support/fixtures/`), extend `test`/`expect` from it instead of `@playwright/test` directly, and ask the user which role(s) the flow needs. If none exists and the flow requires being logged in, say so and ask how the project wants that handled before writing the test.
- DB/fixture-data helpers live in `e2e/support/utils.ts` as `seedTestData()`/`clearTestData()` — commented-out, documented slots until the project wires them to a real endpoint. Check whether they're implemented before relying on them; if not, ask the user for the actual seed/clear mechanism (an API endpoint, a script, direct DB access) rather than guessing one.

## Workflow

### 1. Understand the flow

Ask the user for:

- [ ] Which user role (if any) performs the action
- [ ] Starting URL / page
- [ ] The sequence of actions (click, fill, submit)
- [ ] What to assert (visible text, element state, navigation, DB change reflected in UI)

### 2. Read the source

Before writing selectors, read the relevant component/page file to find existing roles, labels, and text. This avoids guessing and fragile selectors.

### 3. Choose selectors

Priority order — stop at the first that works:

1. `getByRole('button', { name: '...' })`, `getByLabel('...')`, `getByRole('heading', { name: '...' })`
2. `getByText('...')` for non-interactive content
3. `getByTestId('...')` — if needed, **add `data-testid` to the source file** and read it back to confirm placement
4. CSS / XPath — never use these

When adding a `data-testid`, use kebab-case and a descriptive name matching the element's purpose (e.g. `data-testid="submit-form-btn"`).

### 4. Confirm the plan

Before writing anything, present a plain-language summary and ask the user to approve it. Use this format:

> Here's my plan:
>
> I'm going to test [feature description], starting from [route]. (as [role], if the flow requires being logged in)
>
> - Add a test marker to the [element description] in `[ComponentFile.tsx]`
> - Add a test marker to the [element description] in `[ComponentFile.tsx]`
> - Create a test file at `e2e/[feature].spec.ts` with the following tests:
>   - [test title in plain English]
>   - [test title in plain English]
>
> Do you agree, or is there anything you'd like to adjust?

Keep iterating — apply the requested changes to the plan and re-present it — until the user confirms. Only proceed to writing once they agree.

### 5. Write the spec

File location: `e2e/<feature-name>.spec.ts`

```ts
import { test, expect } from "@playwright/test";
// If the project has an auth fixture, import test/expect from it instead:
// import { test, expect } from "./support/fixtures/auth";

test.describe("Feature name", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/target-route");
  });

  test("user can do X and sees Y", async ({ page }) => {
    await page.getByRole("button", { name: "Action" }).click();
    await expect(page.getByText("Expected result")).toBeVisible();
  });
});
```

Key patterns:

- Always `await` every Playwright call
- Use `expect(...).toBeVisible()` not `.toBeInViewport()` for content assertions
- Use `expect(...).toHaveText(...)` or `.toContainText(...)` for text content
- For DB changes: navigate or reload after the action, then assert the updated UI reflects the change
- Group related tests inside `test.describe()` with shared `beforeEach` setup

**DB isolation (when tests read or write DB state):**

Use `beforeEach`/`afterEach` to seed and clear, and force serial execution to prevent parallel tests from corrupting each other's data. The snippet below is an example showing where seed/clear calls go — adapt the route and test body to the actual feature, and confirm `seedTestData`/`clearTestData` are actually implemented before relying on them (see Project setup above):

```ts
import { seedTestData, clearTestData } from "./support/utils";

test.describe("Feature name", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await seedTestData();
    await page.goto("/target-route");
  });

  test.afterEach(async () => {
    await clearTestData();
  });

  test("user can do X and sees Y", async ({ page }) => {
    // ...
  });
});
```

If the test does not touch DB state (pure navigation, static content), omit seed/clear entirely.

The seed/clear helpers and whatever they call should be kept up to date as the data model evolves — if a new test requires data the current seed doesn't provide, update the seed logic accordingly.

### 6. Verify selectors exist

After writing the test, re-read the source component to confirm every selector target is reachable. If you added a `data-testid`, confirm it's in the saved file.

### 7. Tell the user how to run it

**Targeted test:**

```bash
docker compose -f docker-compose-e2e.yml run --build --rm playwright \
  node_modules/.bin/playwright test e2e/<feature-name>.spec.ts
```

**Full suite:**

```bash
bash scripts/e2e-ci.sh
```

**Interactive UI (filter and re-run from the browser):**

```bash
bash scripts/e2e-ui.sh
```
