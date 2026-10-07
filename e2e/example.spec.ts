import { expect, test } from "@playwright/test";
import { API_URL } from "./support/utils.js";

// A minimal example proving the stack is wired correctly end-to-end: the
// web app renders and responds to a click, and the api is reachable from
// the playwright container. Replace/expand once the app has real flows
// worth covering.
test("web app renders and increments the counter", async ({ page }) => {
  await page.goto("/");

  const count = page.getByTestId("count");
  await expect(count).toHaveText("0");

  await page.getByRole("button", { name: "Increment" }).click();
  await expect(count).toHaveText("1");
});

test("api is reachable and healthy", async ({ request }) => {
  const response = await request.get(`${API_URL}/api/v1/healthcheck`);
  expect(response.ok()).toBe(true);

  const body = await response.json();
  expect(body.status).toBe("OK");
});
