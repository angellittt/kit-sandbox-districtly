// design-system-kit 0.4.1 · profile shadcn · kit extension (replaces the stock file when chosen)
"use client";

import * as React from "react";
import { format as formatDate, isValid, parse as parseDate } from "date-fns";
import type { Locale } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dsDateFormat, dsLocale } from "@/lib/ds-settings";
import { cn } from "cn";

/**
 * Date Picker — a calendar in a popover, with an optional typed input.
 *
 * Kit file, whole (no registry item exists): shadcn's documented
 * composition of stock Popover + Calendar + an outline icon Button, in
 * single and range modes. Uses STOCK Popover; width and padding are set with
 * `className` on PopoverContent.
 *
 * Baseline (in this file because it has no stock file):
 * - `defaultMonth` follows the typed or selected value (the documented
 *   composition opens on today's month).
 * - `locale` defaults to `dsLocale`, and `dateFormat` to `dsDateFormat`
 *   (`@/lib/ds-settings`). Per the contract, a set `dateFormat` overrides the
 *   locale's own pattern; otherwise the pattern comes from the locale.
 *
 * Kit extension (candidate, profile capability "Typed date entry"):
 * typed `Input`s with two-way sync, `patternFor` / `hintFor` / `parseTyped`
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
  locale: Locale = dsLocale,
  dateFormat: string = dsDateFormat,
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
  locale: Locale = dsLocale,
  dateFormat: string = dsDateFormat,
): string {
  return patternFor(locale, dateFormat).replace(/d/g, "D").replace(/y/g, "Y");
}

/** Parse a typed date in the active pattern. Returns null when it is not one. */
export function parseTyped(
  text: string,
  locale: Locale = dsLocale,
  dateFormat: string = dsDateFormat,
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
};

const defaultStrings: DatePickerStrings = {
  invalid: (hint) => `Use ${hint} — for example ${hint.replace(/[A-Z]/g, "0")}`,
  endBeforeStart: "The end date can't be before the start date",
  openLabel: "Open calendar",
  startLabel: "Start date",
  endLabel: "End date",
};

type Common = {
  locale?: Locale;
  /**
   * The format as a person writes it ("DD/MM/YYYY"). Defaults to the
   * client's `dateFormat` setting; empty means "use the locale's pattern".
   */
  dateFormat?: string;
  /** Hides the typed input, leaving the calendar button alone. */
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

function CalendarButton({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label={label}
            disabled={disabled}
          />
        }
      >
        <CalendarIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function DatePicker(props: DatePickerProps) {
  const {
    locale = dsLocale,
    dateFormat = dsDateFormat,
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

  // ---- single ---------------------------------------------------------------
  if (props.mode !== "range") {
    return (
      <SingleDatePicker
        {...props}
        id={id}
        className={className}
        locale={locale}
        dateFormat={dateFormat}
        typed={typed}
        disabled={disabled}
        strings={strings}
        pattern={pattern}
        hint={hint}
        fmt={fmt}
        onValidationChange={onValidationChange}
      />
    );
  }

  // ---- range ----------------------------------------------------------------
  return (
    <RangeDatePicker
      {...props}
      id={id}
      className={className}
      locale={locale}
      dateFormat={dateFormat}
      typed={typed}
      disabled={disabled}
      strings={strings}
      pattern={pattern}
      hint={hint}
      fmt={fmt}
      onValidationChange={onValidationChange}
    />
  );
}

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
  const [text, setText] = React.useState(() => fmt(value));
  const [error, setError] = React.useState<string | null>(null);

  // Picking updates the input.
  React.useEffect(() => {
    setText(fmt(value));
    setError(null);
    onValidationChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Typing updates the calendar.
  const commit = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setError(null);
      onValidationChange?.(null);
      onChange(undefined);
      return;
    }
    const parsed = parseTyped(next, locale, dateFormat);
    if (!parsed) {
      const message = strings.invalid(hint);
      setError(message);
      onValidationChange?.(message);
      return;
    }
    setError(null);
    onValidationChange?.(null);
    onChange(parsed);
  };

  return (
    <div
      data-slot="date-picker"
      data-mode="single"
      className={cn("flex items-start gap-2", className)}
    >
      {typed && (
        <Input
          id={id}
          data-slot="date-picker-input"
          value={text}
          disabled={disabled}
          placeholder={hint}
          aria-invalid={!!error}
          onChange={(e) => commit(e.target.value)}
        />
      )}
      <CalendarButton label={strings.openLabel} disabled={disabled}>
        <Calendar
          mode="single"
          locale={locale}
          selected={value}
          // Open on the typed month, not on today: otherwise typing a date
          // and then opening the calendar shows the wrong page of it.
          defaultMonth={value}
          onSelect={onChange}
          autoFocus
        />
      </CalendarButton>
    </div>
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
  const [startText, setStartText] = React.useState(() => fmt(value?.from));
  const [endText, setEndText] = React.useState(() => fmt(value?.to));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setStartText(fmt(value?.from));
    setEndText(fmt(value?.to));
    setError(null);
    onValidationChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.from, value?.to]);

  const commit = (which: "from" | "to", next: string) => {
    if (which === "from") setStartText(next);
    else setEndText(next);

    const raw = which === "from" ? next : startText;
    const rawOther = which === "from" ? endText : next;
    const from = raw.trim() ? parseTyped(raw, locale, dateFormat) : undefined;
    const to = rawOther.trim()
      ? parseTyped(rawOther, locale, dateFormat)
      : undefined;

    const typedButUnparsed = (raw.trim() && !from) || (rawOther.trim() && !to);
    if (typedButUnparsed) {
      const message = strings.invalid(hint);
      setError(message);
      onValidationChange?.(message);
      return;
    }
    if (from && to && to < from) {
      setError(strings.endBeforeStart);
      onValidationChange?.(strings.endBeforeStart);
      return;
    }
    setError(null);
    onValidationChange?.(null);
    onChange(
      from || to ? { from: from ?? undefined, to: to ?? undefined } : undefined,
    );
  };

  return (
    <div
      data-slot="date-picker"
      data-mode="range"
      className={cn("flex items-start gap-2", className)}
    >
      {typed && (
        <>
          <Input
            id={id}
            data-slot="date-picker-input"
            data-part="start"
            value={startText}
            disabled={disabled}
            placeholder={hint}
            aria-label={strings.startLabel}
            aria-invalid={!!error}
            onChange={(e) => commit("from", e.target.value)}
          />
          <Input
            data-slot="date-picker-input"
            data-part="end"
            value={endText}
            disabled={disabled}
            placeholder={hint}
            aria-label={strings.endLabel}
            aria-invalid={!!error}
            onChange={(e) => commit("to", e.target.value)}
          />
        </>
      )}
      <CalendarButton label={strings.openLabel} disabled={disabled}>
        <Calendar
          mode="range"
          locale={locale}
          selected={value}
          defaultMonth={value?.from}
          onSelect={onChange}
          numberOfMonths={2}
          autoFocus
        />
      </CalendarButton>
    </div>
  );
}
