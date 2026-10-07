import { describe, expect, it } from "vitest";
import { render, screen } from "@/tests/utils";
import App from "@/App";

describe("App", () => {
  it("should render a button", async () => {
    await render(<App />);
    expect(
      screen.getByRole("button", { name: /increment/i }),
    ).toBeInTheDocument();
  });
  it("should increment count on button click", async () => {
    const { user } = await render(<App />);
    const button = screen.getByRole("button", { name: /increment/i });
    const count = screen.getByTestId("count");
    expect(count.textContent).toBe("0");
    await user.click(button);
    expect(count.textContent).toBe("1");
    expect(button).not.toBeDisabled();
  });
});
