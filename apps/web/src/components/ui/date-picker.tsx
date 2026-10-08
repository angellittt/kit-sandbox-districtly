// design-system-kit 0.8.0 · profile shadcn · kit extension (replaces the stock file when chosen)
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
import { dateFormat as appDateFormat, locale as appLocale } from "@/lib/locale";
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
 * - `locale` defaults to `appLocale`, and `dateFormat` to `appDateFormat`
 *   (`@/lib/locale`). Per the contract, a set `dateFormat` overrides the
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

  // Picking updates the input (through `value`) and clears any typed error.
  const pick = (date: Date | undefined) => {
    setDraft(null);
    onValidationChange?.(null);
    onChange(date);
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
          onSelect={pick}
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

  const pick = (range: DateRange | undefined) => {
    setDraft(null);
    onValidationChange?.(null);
    onChange(range);
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
          onSelect={pick}
          numberOfMonths={2}
          autoFocus
        />
      </CalendarButton>
    </div>
  );
}
