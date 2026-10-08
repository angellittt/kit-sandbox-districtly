// design-system-kit 0.5.0 · profile shadcn · kit extension test
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { enGB, enUS } from "date-fns/locale";

import {
  DatePicker,
  hintFor,
  parseTyped,
  patternFor,
} from "@/components/ui/date-picker";

/**
 * Locale fixture: the component defaults to the app's locale module
 * (`@/lib/locale`). Mock it so the tests don't depend on any app's choices:
 * en-US, weeks start on Sunday, no dateFormat override.
 */
vi.mock("@/lib/locale", async () => {
  const { enUS } = await import("date-fns/locale");
  return {
    locale: enUS,
    localeTag: "en-US",
    weekStartsOn: 0,
    dateFormat: "",
  };
});

/**
 * The typed input is a kit extension, so these cover the behaviour the
 * extension exists to own: parsing, the error text, the range rule, and the
 * client's dateFormat overriding the locale's pattern.
 */

describe("the locale's pattern", () => {
  it("derives the pattern rather than hardcoding one", () => {
    expect(patternFor(enUS)).toBe("MM/dd/yyyy");
    expect(patternFor(enGB)).toBe("dd/MM/yyyy");
  });

  it("spells the hint for a person", () => {
    expect(hintFor(enUS)).toBe("MM/DD/YYYY");
    expect(hintFor(enGB)).toBe("DD/MM/YYYY");
  });

  it("defaults to the client's locale when no dateFormat is set", () => {
    expect(patternFor()).toBe("MM/dd/yyyy");
    expect(hintFor()).toBe("MM/DD/YYYY");
  });
});

describe("the client's dateFormat", () => {
  it("overrides the locale's pattern when set", () => {
    expect(patternFor(enUS, "YYYY-MM-DD")).toBe("yyyy-MM-dd");
    expect(hintFor(enUS, "YYYY-MM-DD")).toBe("YYYY-MM-DD");
  });

  it("reads a person's lowercase mm as month, not minutes", () => {
    expect(patternFor(enUS, "dd/mm/yyyy")).toBe("dd/MM/yyyy");
  });

  it("parses in the overriding format", () => {
    const d = parseTyped("2026-03-14", enUS, "YYYY-MM-DD");
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(14);
    // The locale's own pattern no longer applies.
    expect(parseTyped("03/14/2026", enUS, "YYYY-MM-DD")).toBeNull();
  });

  it("is honoured by the component", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value={undefined}
        onChange={onChange}
        locale={enUS}
        dateFormat="YYYY-MM-DD"
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("placeholder", "YYYY-MM-DD");
    await user.type(input, "2026-03-14");
    const last = onChange.mock.calls.at(-1)?.[0] as Date;
    expect(last).toBeInstanceOf(Date);
    expect(last.getDate()).toBe(14);
  });
});

describe("parsing a typed date", () => {
  it("accepts the locale's format", () => {
    const d = parseTyped("03/14/2026", enUS);
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2); // March
    expect(d!.getDate()).toBe(14);
  });

  it("reads the same digits differently per locale", () => {
    // 03/04 is 3 April in en-GB and 4 March in en-US.
    expect(parseTyped("03/04/2026", enGB)!.getMonth()).toBe(3);
    expect(parseTyped("03/04/2026", enUS)!.getMonth()).toBe(2);
  });

  it("rejects text that is not a date", () => {
    expect(parseTyped("not a date", enUS)).toBeNull();
    expect(parseTyped("14/03/2026", enUS)).toBeNull(); // month 14
  });

  it("rejects overflow rather than rolling it forward", () => {
    // date-fns' parse is lenient; the round-trip check is what catches this.
    expect(parseTyped("02/31/2026", enUS)).toBeNull();
  });

  it("treats empty as no date, not an error", () => {
    expect(parseTyped("", enUS)).toBeNull();
    expect(parseTyped("   ", enUS)).toBeNull();
  });
});

describe("single date picker", () => {
  it("reports a parsed date to the caller", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        id="due"
        value={undefined}
        onChange={onChange}
        locale={enUS}
      />,
    );
    await user.type(screen.getByRole("textbox"), "03/14/2026");
    const last = onChange.mock.calls.at(-1)?.[0] as Date;
    expect(last).toBeInstanceOf(Date);
    expect(last.getMonth()).toBe(2);
    expect(last.getDate()).toBe(14);
  });

  it("marks the input invalid and says how to fix it", async () => {
    const user = userEvent.setup();
    const onValidationChange = vi.fn();
    render(
      <DatePicker
        value={undefined}
        onChange={() => {}}
        locale={enUS}
        onValidationChange={onValidationChange}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "99/99/9999");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const message = onValidationChange.mock.calls.at(-1)?.[0] as string;
    expect(message).toContain("MM/DD/YYYY");
  });

  it("clears the error once the text parses", async () => {
    const user = userEvent.setup();
    const onValidationChange = vi.fn();
    render(
      <DatePicker
        value={undefined}
        onChange={() => {}}
        locale={enUS}
        onValidationChange={onValidationChange}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "99/99/9999");
    await user.clear(input);
    await user.type(input, "03/14/2026");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(onValidationChange.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("picking a date updates the input", () => {
    const { rerender } = render(
      <DatePicker value={undefined} onChange={() => {}} locale={enUS} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
    rerender(
      <DatePicker
        value={new Date(2026, 2, 14)}
        onChange={() => {}}
        locale={enUS}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("03/14/2026");
  });

  it("opens the calendar on the value's month and reports a picked day", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value={new Date(2026, 2, 14)}
        onChange={onChange}
        locale={enUS}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open calendar" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("March 2026")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /March 20(th)?, 2026/ }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const picked = onChange.mock.calls[0][0] as Date;
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual(
      [2026, 2, 20],
    );
  });
});

describe("range date picker", () => {
  const renderRange = (onValidationChange = vi.fn(), onChange = vi.fn()) => {
    render(
      <DatePicker
        mode="range"
        value={undefined}
        onChange={onChange}
        locale={enUS}
        onValidationChange={onValidationChange}
      />,
    );
    return {
      start: screen.getByLabelText("Start date"),
      end: screen.getByLabelText("End date"),
      onValidationChange,
      onChange,
    };
  };

  it("accepts a start before its end", async () => {
    const user = userEvent.setup();
    const { start, end, onChange, onValidationChange } = renderRange();
    await user.type(start, "03/01/2026");
    await user.type(end, "03/14/2026");
    expect(onValidationChange.mock.calls.at(-1)?.[0]).toBeNull();
    const range = onChange.mock.calls.at(-1)?.[0];
    expect(range.from.getDate()).toBe(1);
    expect(range.to.getDate()).toBe(14);
  });

  it("refuses an end before the start", async () => {
    const user = userEvent.setup();
    const { start, end, onValidationChange } = renderRange();
    await user.type(start, "03/14/2026");
    await user.type(end, "03/01/2026");
    expect(onValidationChange.mock.calls.at(-1)?.[0]).toBe(
      "The end date can't be before the start date",
    );
    expect(end).toHaveAttribute("aria-invalid", "true");
  });

  it("accepts the same day at both ends", async () => {
    const user = userEvent.setup();
    const { start, end, onValidationChange } = renderRange();
    await user.type(start, "03/14/2026");
    await user.type(end, "03/14/2026");
    expect(onValidationChange.mock.calls.at(-1)?.[0]).toBeNull();
  });
});
