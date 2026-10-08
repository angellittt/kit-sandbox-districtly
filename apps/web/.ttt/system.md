# System

How Districtly is set up. The rules every TTT design system follows live in the kit, not here.

| | |
|---|---|
| **Versions** | schema `ttt-ds/1` · profile `shadcn` 1.3 · kit 0.4.1 |
| **Owner** | angelli.dimatulac@ttt.studio |
| **Code** | `https://github.com/angellittt/kit-sandbox-districtly (apps/web)` · config `.ttt/design-system.json` |
| **Figma** | [Districtly — Design System](https://www.figma.com/design/8d21KnCRPlXMbLlbTCsKGN) · key `8d21KnCRPlXMbLlbTCsKGN` |
| **Tracker** | https://app.clickup.com/8593845/v/f/90119323306/90115204389 |
| **Components** | 0 implemented · 34 validated |

**Client settings** — locale `en-CA` · week starts Monday · typed date format `YYYY-MM-DD` (displayed dates follow the Voice rule: 14 Nov 2026).

**Districtly-specific choices** — client extensions, client-added ramps and decisions that differ from the profile, one line each.

- `brand-secondary` is a lightened Civic Ink (`#384766`); Civic Ink itself (`#14213D`) is darker than any ramp step.
- Ochre Signal `#F5A623` is both the brand accent and the cautionary status colour.
- Code: a Vite app in a pnpm monorepo (`apps/web`); global CSS at `src/config/global.css`; fonts loaded by `src/styles/fonts.css` (Fontsource 5.3.0 woff2, latin and latin-ext).

**Open deviations** — none.
