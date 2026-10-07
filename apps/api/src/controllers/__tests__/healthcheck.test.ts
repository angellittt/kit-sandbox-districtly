import { describe, expect, test } from "vitest";
import axios from "axios";
import { getTestAddress } from "../../tests/utils.js";

describe("API tests", () => {
  test("healthcheck works", async () => {
    const { status, data } = await axios.get(
      `${getTestAddress()}/api/v1/healthcheck`,
    );
    expect(status).toBe(200);
    const { uptime, timestamp, status: healthStatus } = data;
    expect(healthStatus).toBe("OK");
    expect(typeof uptime).toBe("number");
    expect(typeof timestamp).toBe("number");
  });
});
