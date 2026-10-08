// design-system-kit 0.4.1 · profile shadcn · wiring: client settings
import { enCA, enUS } from "date-fns/locale";
import type { Locale } from "date-fns";

// Path from this file to the repo config. Setup adjusts it if lib/ isn't at src/lib.
// A default import: bundlers are dropping named imports from JSON.
import dsConfig from "../../.ttt/design-system.json";

const { settings } = dsConfig;

/**
 * Client settings — locale, week start and date format.
 *
 * These shape what components render but are not tokens, so the contract
 * keeps them in `.ttt/design-system.json` under `settings`. This module is the
 * one place that reads them: kit components depend on `@/lib/ds-settings`,
 * never on a hardcoded locale.
 *
 * The export names are the kit's contract. The LOCALES registry is the
 * repo's: Setup adds the client's locale. Adding one means adding its
 * date-fns import here, deliberately — importing them all would put every
 * locale in the bundle.
 */
const LOCALES: Record<string, Locale> = {
  "en-CA": enCA,
  "en-US": enUS,
};

function resolveLocale(tag: string): Locale {
  const locale = LOCALES[tag];
  if (!locale) {
    throw new Error(
      `.ttt/design-system.json sets settings.locale to "${tag}", which lib/ds-settings.ts does not carry. ` +
        `Add its date-fns locale to LOCALES.`,
    );
  }
  return locale;
}

/** The app's locale, as a date-fns locale. */
export const dsLocale: Locale = resolveLocale(settings.locale);

/** The locale tag itself, for `Intl` and for `lang` attributes. */
export const dsLocaleTag: string = settings.locale;

/**
 * Which day a week starts on, 0 = Sunday. Always stated, never derived from
 * the locale: a client can keep en-US dates and still start weeks on Monday.
 */
export const dsWeekStartsOn = settings.weekStartsOn as
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6;

/**
 * The date format as a person reads it ("DD/MM/YYYY"), or "" to use the
 * locale's own pattern. When set it overrides the locale's pattern.
 */
export const dsDateFormat: string = settings.dateFormat ?? "";
