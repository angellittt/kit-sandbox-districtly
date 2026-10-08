# Design system

<!-- Written by the design-system Setup skill and kept current by Sync.
     Schema ttt-ds/1 · profile shadcn · kit 0.5.0. Other repo docs
     point here rather than repeating any of it. -->

**Districtly is the source of truth; shadcn is the scaffolding.** The look
comes from the design system. If a component renders differently from its
preview, fix the port — don't adjust the CSS to taste.

- **Design system** https://claude.ai/artifact/UQLUACiuG2Mcy4NJHxQ5qu — brand rules in `project/README.md`,
  setup summary in `project/01-system.md`, the Tailwind names in
  `project/02-using-in-code.md`, per-component docs and previews under
  `project/components/`.
- **Tracker** https://app.clickup.com/8593845/v/f/90119323306/90115204389
- **Connection** `.ttt/design-system.json` (links, schema, profile, kit
  version, paths, `lastSynced`).

## Usage rules

- **Use the stock component.** Everything lives in `src/components/ui (`@/components/ui`)`. A kit or
  client extension needs a stated reason — a capability stock doesn't offer —
  recorded in its proposal. Don't fork a component to style it.
- **Components are code-owned, tokens are design-owned.** Token and brand
  changes come from the design system and sync down. Component changes are
  made here and published back after review. Never hand-edit a generated file
  to work around a token.
- **Errors pair an icon and a word with colour.** Colour alone never says
  "error". Write errors as fixes: "Use at least 8 characters", not "Invalid".
- Sentence case everywhere. No emoji in UI copy.
- Wrap anything that scales or slides in `motion-safe:`. Reduced motion drops
  scale and spring regardless of the duration tokens.

None yet.

## Tokens

Generated — never hand-edited:

| File                       | What it is                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ttt/tokens.json`         | The token snapshot pulled from the design system. Everything generated reads this, never claude.ai, so CI can rebuild without access.                                                              |
| `src/styles/ds-tokens.css` | **Generated** by `scripts/ds-tokens.mjs`: every token as a CSS variable, Light/Dark on `[data-theme]`, the shadcn variables, the Tailwind `@theme` mapping, the spacing base and the type classes. |
| `src/config/global.css`    | Hand-written. Tailwind entry, the token import, the dark variant, the base layer and the focus rule.                                                                                               |

Regenerate after a token change — it should touch no component file — then
check the snapshot and contrast:

```bash
node scripts/ds-tokens.mjs
pnpm run ds:validate     # config, snapshot, wiring; exits 1 on any error
pnpm run ds:contrast     # every contrast pair in every theme
```

Contrast failures are design's to fix (tokens are design-owned): log a
deviation, don't change a token here. Pairs below their minimum on purpose
are listed under `contrast.intentional` in `.ttt/design-system.json`, each
with its reason.

**Watch the naming clash.** shadcn's `secondary` and `accent` are neutral
greys, not brand colours. The brand ones are `brand-secondary` and
`brand-accent` (each with `-foreground`, `-soft`, `-text`).

Every semantic token is also a Tailwind utility of the same name —
`text-label-strong`, `border-line-strong`, `bg-status-positive-soft`. Only
semantic tokens are mapped; primitives never are. Text styles are
`type-<style>` classes. Spacing utilities read the spacing
tokens: `p-4` is `space-4`.

Motion is tokenised too: `ease-standard` / `ease-expressive` and
`duration-fast` / `-normal` / `-slow`.

## Styling guardrails

Custom UI uses **only** the Tailwind names from the mapping:

- No hex values.
- No arbitrary colour values (`bg-[#…]`, `text-[rgb(…)]`).
- No default palette classes (`bg-zinc-…`, `text-slate-…`).
- Reach for a token or add an alias in the mapping — never a literal.

`eslint .` runs the accessibility rules (jsx-a11y) on every file.

## Locale defaults

Locale, week start and date format are **not tokens**: they're product
decisions, and the app owns them in `@/lib/locale` (Districtly:
`en-CA`, weeks start on Monday, typed dates as `YYYY-MM-DD` (displayed dates follow the brand voice: 14 Nov 2026)).
Change them there, in a PR, like any other code.

```ts
import { locale, localeTag, weekStartsOn, dateFormat } from "@/lib/locale";
```

`DatePicker` and `Calendar` default to those; pass `locale`, `weekStartsOn`
or `dateFormat` to override one instance (a user's preference, a second
language). **Don't import a date-fns locale in a component** — import only the
locale you use, in `locale.ts`; importing them all would put every locale in
the bundle. Keep the exports plain literals: the kit's scripts read them.

The design system's System section records the same decision.
`npm run ds:validate -- --system <01-system.md>` warns when the two differ;
fix whichever side is out of date.

## Component rules

### Field

Compose form controls as `Field` → `FieldLabel` → control →
`FieldDescription` / `FieldError`. Set `data-invalid` on the `Field` and
`aria-invalid` on the control. Two things Field does not do for you:

- **Wire `aria-describedby` by hand.** Field generates no ids, so give the
  `FieldError` an id and point the control at it. Nothing warns you if you
  forget.
- **Move focus on a failed submit.** `role="alert"` announces the message,
  but a keyboard user is left on the submit button. Focus the first invalid
  control yourself.

### Loading buttons

Always use all three — the spinner, `disabled` (prevents double-submit) and
`aria-busy`:

```tsx
<Button disabled={saving} aria-busy={saving}>
  {saving && <Spinner />}
  Save
</Button>
```

`Spinner` takes no `loading` prop. The three pieces are composed at the call
site, deliberately, so a button can stay disabled for reasons that have
nothing to do with loading.

None yet.

## Replaced by stock

These kit extensions were superseded by stock components and **no longer
exist**. Don't reintroduce them:

| Gone                                               | Use instead                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `InputGroup` / `InputGroupIcon` (from `input.tsx`) | `InputGroup` / `InputGroupAddon` / `InputGroupInput` from `input-group.tsx` |
| `InputMessage`                                     | `FieldDescription` / `FieldError`                                           |
| `TableEmpty`                                       | `TableRow` → `TableCell colSpan` → `Empty`, with no wrapper                 |
| `Tabs` `variant="pill" \| "underline"`             | Stock `TabsList variant="default" \| "line"`                                |
| Card `compact`                                     | Stock `Card size="sm"`                                                      |

## Component inventory

The design system's inventory is authoritative for which components exist and
their status (`proposed` → `validated` → `implemented`). `validated` entries
are agreed in review but not yet in code — don't import them.

---

# Gotchas already paid for

- **`outline-none` kills focus rings.** In Tailwind v4 it sets
  `--tw-outline-style: none`, and `focus-visible:outline-2` reads its style
  back from that variable. Focus comes from a single `:focus-visible` rule in
  the global CSS; only inset offsets are set per component.
- **Base UI sets `aria-disabled`, not `disabled`,** on focusable-when-disabled
  parts (Tabs, Accordion triggers). Style them with `aria-disabled:`.
- **Renamed event props type-check.** `onSelect` is a valid DOM attribute, so
  a Radix-style `DropdownMenuItem onSelect` builds and never fires; Base UI's
  is `onClick`. Exercise handlers in the browser after any primitive change.
- **Sonner's stylesheet outranks plain utilities.** Anything it also sets
  needs `!` in `sonner.tsx`, and it colours the description from its own
  variable rather than `--normal-text`.
- **Use `pnpm run build:safe`, not `pnpm run build`, while the dev server is
  running** (Next.js). Both write to `.next` otherwise, and the running server
  starts 404ing every chunk. `build:safe` targets `.next-build`. On Vite it is
  plain `vite build` — the dev server never writes `dist/`.
- **Restart the dev server after changing `postcss.config.mjs`** (Next.js) or
  the Tailwind plugin in `vite.config` (Vite) — Tailwind silently emits zero
  utilities otherwise.
- `@tanstack/react-table` must stay on **v8**; v9 has no `useReactTable`.
- **Tailwind's automatic source detection scans more than you think** — it
  walks up from the CSS entry, markdown included. The global CSS declares
  `@source` explicitly, and the preview bundle's entry uses
  `@import "tailwindcss" source(none)`.

## Publish-back tooling

Seven scripts, all **kit files** (design-system-kit 0.5.0) —
generic across repos on profile `shadcn`. Fix them in the kit, not here, so
the fix carries:

| Script                        | Makes or checks                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ds-tokens.mjs`       | `src/styles/ds-tokens.css` from the token snapshot                                                                                                                                                                         |
| `scripts/ds-validate.mjs`     | the repo config, the snapshot and the theme block's `@source` (`--preflight` adds installed versions vs `scripts/tested-range.json`; `--system <01-system.md>` checks client-added ramps are listed in the System section) |
| `scripts/ds-contrast.mjs`     | every pair in `scripts/contrast-pairs.json`, in every theme                                                                                                                                                                |
| `scripts/ds-pack-react.mjs`   | React + ReactDOM as classic-script globals for the preview frame                                                                                                                                                           |
| `scripts/ds-build-bundle.mjs` | `bundle.js` + `bundle.css` from `src/components/ui (`@/components/ui`)`                                                                                                                                                    |
| `scripts/ds-styling-maps.mjs` | each component README's styling map; `--used-by` the tokens' "Used by" lists; `--using-in-code` the design system's "Using in code" section                                                                                |
| `scripts/ds-types.mjs`        | `components/index.d.ts` from the `src/components/ui (`@/components/ui`)` exports                                                                                                                                           |

**Generated means generated:** if the design system calls a document
generated, a script here produces it. Don't hand-edit one.

`ds-styling-maps.mjs` reads the TSX, so **where a class string lives decides
which part owns it.** Keep `data-slot` on the element the classes are
actually applied to.

After any dependency bump:

```bash
pnpm run ds:build-bundle -- --check      # verify the toolchain pins
node scripts/__fixtures__/run.mjs       # verify it still works generically
```
