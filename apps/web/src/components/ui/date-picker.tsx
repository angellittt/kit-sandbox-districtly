// design-system-kit 0.8.1 · profile shadcn · kit extension (replaces the stock file when chosen)
"use client";

import * as React from "react";
import { format as formatDate, isValid, parse as parseDate } from "date-fns";
import type { Locale } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateFormat as appDateFormat, locale as appLocale } from "@/lib/locale";
import { cn } from "cn";

/**
 * Date Picker — a calendar in a popover, typed into or picked from a button.
 *
 * Kit file, whole (no registry item exists): shadcn's two documented
 * compositions, in single and range modes, from STOCK Popover, Calendar,
 * Input Group and Button:
 * - typed (default): the "Input" example — an Input Group with the calendar
 *   button inside it at the end; ArrowDown in the input opens the calendar.
 * - `typed={false}`: the "Basic" / "Range" examples — an outline Button
 *   showing the value (or a placeholder) that opens the calendar.
 * Picking a single date closes the calendar, as in the examples; a range
 * stays open until the person closes it.
 *
 * Baseline (in this file because it has no stock file):
 * - `defaultMonth` follows the typed or selected value (the documented
 *   composition opens on today's month).
 * - `locale` defaults to `appLocale`, and `dateFormat` to `appDateFormat`
 *   (`@/lib/locale`). Per the contract, a set `dateFormat` overrides the
 *   locale's own pattern; otherwise the pattern comes from the locale.
 *
 * Kit extension (candidate, profile capability "Typed date entry"):
 * typed inputs with two-way sync, `patternFor` / `hintFor` / `parseTyped`
 * with overflow rejection, `aria-invalid`, `onValidationChange`, the range
 * end-before-start rule, the `typed` opt-out and `strings` overrides.
 */

/**
 * A date format as a person writes it ("MM/DD/YYYY", "dd.mm.yyyy") as a
 * date-fns pattern ("MM/dd/yyyy"). Case-insensitive per letter: a person's
 * "mm" means month, never date-fns' minutes.
 */
function patternFromFormat(format: string): string {
  return format
    .replace(/[dD]/g, "d")
    .replace(/[yY]/g, "y")
    .replace(/[mM]/g, "M");
}

/**
 * The date-fns pattern for typed dates: the client's `dateFormat` when set,
 * otherwise the locale's own short date pattern, derived rather than
 * hardcoded.
 */
export function patternFor(
  locale: Locale = appLocale,
  dateFormat: string = appDateFormat,
): string {
  if (dateFormat?.trim()) return patternFromFormat(dateFormat.trim());
  // date-fns exposes the locale's short date format; fall back to the ISO-ish
  // ordering if a locale does not define one.
  const raw = locale.formatLong?.date({ width: "short" }) ?? "yyyy-MM-dd";
  // date-fns patterns use single letters for non-padded parts; the hint shown
  // to a person should be the padded, readable form.
  return raw
    .replace(/\bM\b/, "MM")
    .replace(/\bd\b/, "dd")
    .replace(/y+/, "yyyy");
}

/** The same pattern spelled for a person: MM/dd/yyyy -> MM/DD/YYYY. */
export function hintFor(
  locale: Locale = appLocale,
  dateFormat: string = appDateFormat,
): string {
  return patternFor(locale, dateFormat).replace(/d/g, "D").replace(/y/g, "Y");
}

/** Parse a typed date in the active pattern. Returns null when it is not one. */
export function parseTyped(
  text: string,
  locale: Locale = appLocale,
  dateFormat: string = appDateFormat,
): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const pattern = patternFor(locale, dateFormat);
  const parsed = parseDate(trimmed, pattern, new Date(), { locale });
  if (!isValid(parsed)) return null;
  // parse() is lenient about overflow (13/40/2026 rolls forward); round-trip
  // it so only a date that formats back to what was typed is accepted.
  if (formatDate(parsed, pattern, { locale }) !== trimmed) return null;
  return parsed;
}

export type DatePickerStrings = {
  /** Shown when the text is not a date at all. */
  invalid: (hint: string) => string;
  /** Shown when a range's end falls before its start. */
  endBeforeStart: string;
  openLabel: string;
  startLabel: string;
  endLabel: string;
  /** The button's text with no value, when `typed` is false. */
  placeholder: string;
  rangePlaceholder: string;
};

const defaultStrings: DatePickerStrings = {
  invalid: (hint) => `Use ${hint} — for example ${hint.replace(/[A-Z]/g, "0")}`,
  endBeforeStart: "The end date can't be before the start date",
  openLabel: "Open calendar",
  startLabel: "Start date",
  endLabel: "End date",
  placeholder: "Pick a date",
  rangePlaceholder: "Pick a date range",
};

type Common = {
  locale?: Locale;
  /**
   * The format as a person writes it ("DD/MM/YYYY"). Defaults to the
   * client's `dateFormat` setting; empty means "use the locale's pattern".
   */
  dateFormat?: string;
  /**
   * False swaps the typed input for a button that shows the value and opens
   * the calendar: picking only, as in shadcn's Basic example.
   */
  typed?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  strings?: Partial<DatePickerStrings>;
  /** Reports the current validation message, or null when the input is fine. */
  onValidationChange?: (message: string | null) => void;
};

type SingleProps = Common & {
  mode?: "single";
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
};

type RangeProps = Common & {
  mode: "range";
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
};

export type DatePickerProps = SingleProps | RangeProps;

/** The calendar's popover, positioned as in shadcn's examples. */
function CalendarContent({
  typed,
  children,
}: {
  typed: boolean;
  children: React.ReactNode;
}) {
  return typed ? (
    // Lines the calendar up with the end of the field, not the button.
    <PopoverContent
      align="end"
      alignOffset={-8}
      sideOffset={10}
      className="w-auto overflow-hidden p-0"
    >
      {children}
    </PopoverContent>
  ) : (
    <PopoverContent align="start" className="w-auto overflow-hidden p-0">
      {children}
    </PopoverContent>
  );
}

/** The calendar button inside the field. */
function FieldTrigger({
  label,
  disabled,
}: {
  label: string;
  disabled?: boolean;
}) {
  return (
    <InputGroupAddon align="inline-end">
      <PopoverTrigger
        render={
          <InputGroupButton
            data-slot="date-picker-trigger"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
          />
        }
      >
        <CalendarIcon />
      </PopoverTrigger>
    </InputGroupAddon>
  );
}

/** The picking-only trigger: an outline button showing the value. */
function ButtonTrigger({
  id,
  text,
  placeholder,
  disabled,
}: {
  id?: string;
  text: string;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <PopoverTrigger
      render={
        <Button
          id={id}
          data-slot="date-picker-trigger"
          data-empty={!text}
          variant="outline"
          disabled={disabled}
          className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
        />
      }
    >
      <CalendarIcon />
      {text || placeholder}
    </PopoverTrigger>
  );
}

/** ArrowDown in a typed input opens the calendar, as in shadcn's example. */
const openOnArrowDown =
  (setOpen: (open: boolean) => void) =>
  (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

export function DatePicker(props: DatePickerProps) {
  const {
    locale = appLocale,
    dateFormat = appDateFormat,
    typed = true,
    disabled,
    id,
    className,
    strings: overrides,
    onValidationChange,
  } = props;
  const strings = { ...defaultStrings, ...overrides };
  const pattern = patternFor(locale, dateFormat);
  const hint = hintFor(locale, dateFormat);
  const fmt = React.useCallback(
    (d: Date | undefined) => (d ? formatDate(d, pattern, { locale }) : ""),
    [pattern, locale],
  );
  const shared = {
    id,
    className,
    locale,
    dateFormat,
    typed,
    disabled,
    strings,
    pattern,
    hint,
    fmt,
    onValidationChange,
  };

  if (props.mode !== "range")
    return <SingleDatePicker {...props} {...shared} />;
  return <RangeDatePicker {...props} {...shared} />;
}

/** Typed text, its validation message, and the value it was typed against. */
type Draft<T> = T & { error: string | null; against: string };

/** A value's identity for the draft: the same instant compares equal. */
const dayKey = (d: Date | undefined) => (d ? String(d.getTime()) : "");

type Shared = {
  locale: Locale;
  dateFormat: string;
  typed: boolean;
  disabled?: boolean;
  strings: DatePickerStrings;
  pattern: string;
  hint: string;
  fmt: (d: Date | undefined) => string;
  onValidationChange?: (message: string | null) => void;
  id?: string;
  className?: string;
};

function SingleDatePicker({
  value,
  onChange,
  locale,
  dateFormat,
  typed,
  disabled,
  strings,
  hint,
  fmt,
  onValidationChange,
  id,
  className,
}: SingleProps & Shared) {
  const [open, setOpen] = React.useState(false);
  // What the person typed, kept only while `value` is still the one it was
  // typed against: when `value` changes (a pick, or the caller setting it),
  // the input shows the new value in the same render. No effect, so no frame
  // of stale text.
  const [draft, setDraft] = React.useState<Draft<{ text: string }> | null>(
    null,
  );
  const current = draft?.against === dayKey(value) ? draft : null;
  const text = current ? current.text : fmt(value);
  const error = current?.error ?? null;

  // Typing updates the calendar.
  const commit = (next: string) => {
    const report = (message: string | null) => {
      setDraft({ text: next, error: message, against: dayKey(value) });
      onValidationChange?.(message);
    };
    if (!next.trim()) {
      report(null);
      onChange(undefined);
      return;
    }
    const parsed = parseTyped(next, locale, dateFormat);
    if (!parsed) {
      report(strings.invalid(hint));
      return;
    }
    report(null);
    onChange(parsed);
  };

  // Picking updates the input (through `value`), clears any typed error and
  // closes the calendar.
  const pick = (date: Date | undefined) => {
    setDraft(null);
    onValidationChange?.(null);
    onChange(date);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        data-slot="date-picker"
        data-mode="single"
        className={cn("w-full", className)}
      >
        {typed ? (
          <InputGroup>
            <InputGroupInput
              id={id}
              data-part="date-picker-input"
              value={text}
              disabled={disabled}
              placeholder={hint}
              aria-invalid={!!error}
              onChange={(e) => commit(e.target.value)}
              onKeyDown={openOnArrowDown(setOpen)}
            />
            <FieldTrigger label={strings.openLabel} disabled={disabled} />
          </InputGroup>
        ) : (
          <ButtonTrigger
            id={id}
            text={fmt(value)}
            placeholder={strings.placeholder}
            disabled={disabled}
          />
        )}
      </div>
      <CalendarContent typed={typed}>
        <Calendar
          mode="single"
          locale={locale}
          selected={value}
          // Open on the typed month, not on today: otherwise typing a date
          // and then opening the calendar shows the wrong page of it.
          defaultMonth={value}
          onSelect={pick}
          autoFocus
        />
      </CalendarContent>
    </Popover>
  );
}

function RangeDatePicker({
  value,
  onChange,
  locale,
  dateFormat,
  typed,
  disabled,
  strings,
  hint,
  fmt,
  onValidationChange,
  id,
  className,
}: RangeProps & Shared) {
  const [open, setOpen] = React.useState(false);
  // As in single mode: the typed text applies only while `value` is the
  // range it was typed against.
  const [draft, setDraft] = React.useState<Draft<{
    start: string;
    end: string;
  }> | null>(null);
  const against = `${dayKey(value?.from)}|${dayKey(value?.to)}`;
  const current = draft?.against === against ? draft : null;
  const startText = current ? current.start : fmt(value?.from);
  const endText = current ? current.end : fmt(value?.to);
  const error = current?.error ?? null;

  const commit = (which: "from" | "to", next: string) => {
    const raw = which === "from" ? next : startText;
    const rawOther = which === "from" ? endText : next;
    const report = (message: string | null) => {
      setDraft({ start: raw, end: rawOther, error: message, against });
      onValidationChange?.(message);
    };

    const from = raw.trim() ? parseTyped(raw, locale, dateFormat) : undefined;
    const to = rawOther.trim()
      ? parseTyped(rawOther, locale, dateFormat)
      : undefined;

    const typedButUnparsed = (raw.trim() && !from) || (rawOther.trim() && !to);
    if (typedButUnparsed) {
      report(strings.invalid(hint));
      return;
    }
    if (from && to && to < from) {
      report(strings.endBeforeStart);
      return;
    }
    report(null);
    onChange(
      from || to ? { from: from ?? undefined, to: to ?? undefined } : undefined,
    );
  };

  // A range stays open: the person picks both ends, then closes it.
  const pick = (range: DateRange | undefined) => {
    setDraft(null);
    onValidationChange?.(null);
    onChange(range);
  };

  const shown = value?.from
    ? [fmt(value.from), fmt(value.to)].filter(Boolean).join(" – ")
    : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        data-slot="date-picker"
        data-mode="range"
        className={cn("w-full", className)}
      >
        {typed ? (
          <InputGroup>
            <InputGroupInput
              id={id}
              data-part="date-picker-input"
              data-end="start"
              value={startText}
              disabled={disabled}
              placeholder={hint}
              aria-label={strings.startLabel}
              aria-invalid={!!error}
              onChange={(e) => commit("from", e.target.value)}
              onKeyDown={openOnArrowDown(setOpen)}
            />
            <InputGroupText aria-hidden>–</InputGroupText>
            <InputGroupInput
              data-part="date-picker-input"
              data-end="end"
              value={endText}
              disabled={disabled}
              placeholder={hint}
              aria-label={strings.endLabel}
              aria-invalid={!!error}
              onChange={(e) => commit("to", e.target.value)}
              onKeyDown={openOnArrowDown(setOpen)}
            />
            <FieldTrigger label={strings.openLabel} disabled={disabled} />
          </InputGroup>
        ) : (
          <ButtonTrigger
            id={id}
            text={shown}
            placeholder={strings.rangePlaceholder}
            disabled={disabled}
          />
        )}
      </div>
      <CalendarContent typed={typed}>
        <Calendar
          mode="range"
          locale={locale}
          selected={value}
          defaultMonth={value?.from}
          onSelect={pick}
          numberOfMonths={2}
          autoFocus
        />
      </CalendarContent>
    </Popover>
  );
}
