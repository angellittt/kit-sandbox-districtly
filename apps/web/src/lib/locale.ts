// design-system-kit 0.5.0 · profile shadcn · wiring: the app's locale defaults
// App-owned: Setup seeds this file from the client's inputs; after that it is
// the app's to edit (dev, or design through a PR). It is not a kit file.
import { enCA } from "date-fns/locale";
import type { Locale } from "date-fns";

/**
 * Locale defaults for date components: Calendar and DatePicker default to
 * these and take a prop to override one instance. They are product decisions,
 * not tokens, so they live in code, where they ship.
 *
 * The design system's System section records the same decision in its Client
 * settings line. `ds:validate --system <01-system.md>` warns when the two
 * differ — fix whichever side is out of date.
 *
 * Keep each value a plain literal: the kit's scripts read this file's source.
 * A runtime locale (a user preference, a second language) can still be passed
 * to the components as props; these stay the defaults.
 */

/** The locale tag, for `Intl` and `lang` attributes. A canonical BCP 47 tag. */
export const localeTag = "en-CA";

/** The date-fns locale for `localeTag`. Import only the one you use. */
export const locale: Locale = enCA;

/** Which day a week starts on, 0 = Sunday. Always stated, never derived from the locale. */
export const weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1;

/**
 * The typed-entry date pattern as a person reads it ("DD/MM/YYYY"), or "" for
 * the locale's own pattern. Numeric only: it is what DatePicker parses.
 */
export const dateFormat: string = "YYYY-MM-DD";
