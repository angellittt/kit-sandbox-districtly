import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ExampleIcon from "../example.svg?react";

// Proves vite-plugin-svgr is wired correctly: importing an SVG with the
// `?react` suffix should yield a React component (an <svg> element), not a
// URL string. Copy this pattern for real icons/illustrations.
describe("svg imported as a React component", () => {
  it("renders as an inline <svg> element", () => {
    const { container } = render(<ExampleIcon data-testid="example-icon" />);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("data-testid", "example-icon");
  });
});
