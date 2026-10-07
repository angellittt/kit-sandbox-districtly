---
name: fix-e2e-test
description: Fix a failing Playwright E2E test or update an existing one to match changed behavior. Use when a test is broken, a selector stopped working, UI text changed, a route changed, or a feature changed and the test needs to reflect new expected behavior.
---

# Fix / Update E2E Test

## Entry points

**You have error output** — paste the Playwright terminal error. Identify the failing test file, line, and assertion from the output, then follow the Fix workflow.

**You know what changed** — describe what changed (text, route, button, behavior). Follow the Update workflow.

## Fix workflow (broken test)

1. **Read the error** to identify: spec file, test name, failing line, error type (selector not found / assertion failed / navigation error)
2. **Read the spec file** (`e2e/<name>.spec.ts`) — understand what the test is doing around the failure
3. **Read the source component/page** for the affected route — find the current state of the element (role, label, text, route)
4. **Confirm the plan** before writing anything. Present a plain-language diagnosis and list of changes, then ask:

   > Here's what I found:
   >
   > [Plain-language explanation of what's broken and why — e.g. "The selector for the Submit button no longer matches because the button text changed from 'Submit' to 'Save'."]
   >
   > Here's what I'll change:
   >
   > - [Plain-language description of each change in `e2e/file.spec.ts`]
   > - ⚠️ This removes coverage for [scenario] — [brief reason] _(only if applicable)_
   >
   > Do you agree, or is there anything you'd like to adjust?

   Keep iterating — apply requested adjustments and re-present — until the user confirms.

5. **Apply the fix**

## Update workflow (feature changed)

1. **Read the spec file** to understand current test expectations
2. **Read the source component/page** for the affected route — find what the UI looks like now
3. **Confirm the plan** before writing anything. Present a plain-language summary and list of changes, then ask:

   > Here's my plan:
   >
   > I'm going to update the test for [feature] to reflect [what changed].
   >
   > - [Plain-language description of each change in `e2e/file.spec.ts`]
   > - ⚠️ This removes coverage for [scenario] — [brief reason] _(only if applicable)_
   >
   > Do you agree, or is there anything you'd like to adjust?

   Keep iterating — apply requested adjustments and re-present — until the user confirms.

4. **Apply the updates**

## DB isolation

When the test touches DB state, ensure `beforeEach`/`afterEach` seed/clear hooks are present with `test.describe.configure({ mode: "serial" })`, calling `seedTestData()`/`clearTestData()` from `e2e/support/utils.ts`. The snippet below is an example showing where the calls go — adapt to the actual test:

```ts
import { seedTestData, clearTestData } from "./support/utils";

test.describe("Feature name", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    await seedTestData();
  });

  test.afterEach(async () => {
    await clearTestData();
  });
});
```

If the test does not touch DB state, omit seed/clear entirely.

`seedTestData`/`clearTestData` are documented slots until the project wires them to a real endpoint or script — if a fix requires data the current seed doesn't provide, update that implementation (and ask the user what the actual seed mechanism should be, if it's still a no-op).

## Selector rules (same as write-e2e-test)

Priority — stop at the first that works:

1. `getByRole('button', { name: '...' })`, `getByLabel('...')`, `getByRole('heading', { name: '...' })`
2. `getByText('...')` for non-interactive content
3. `getByTestId('...')` — if needed, add `data-testid="kebab-case-name"` to the source file
4. CSS / XPath — never use these

## Common failure patterns

| Error                          | Likely cause                 | Fix                              |
| ------------------------------ | ---------------------------- | -------------------------------- |
| `Locator not found`            | Text/role changed in UI      | Read source, update selector     |
| `Expected visible, got hidden` | Element conditionally hidden | Check render condition in source |
| `Navigation timeout`           | Route changed                | Update `page.goto()` path        |
| `Assertion failed`             | Feature behavior changed     | Update `expect()` to new value   |

## How to run the fixed test

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
