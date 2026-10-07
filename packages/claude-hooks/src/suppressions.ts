/**
 * Markers that switch a check off for part of the code. They are sometimes
 * the right call, so the hook warns instead of blocking and asks for a reason.
 */
const MARKERS: { label: string; pattern: RegExp }[] = [
  { label: "eslint-disable", pattern: /eslint-disable/g },
  { label: "@ts-ignore", pattern: /@ts-ignore/g },
  { label: "@ts-nocheck", pattern: /@ts-nocheck/g },
  { label: "@ts-expect-error", pattern: /@ts-expect-error/g },
  // it.skip(, describe.only(, test.concurrent.only(, test.fixme( ...
  {
    label: ".skip",
    pattern: /\b(?:it|test|describe|suite)[.\w]*\.skip\s*\(/g,
  },
  {
    label: ".only",
    pattern: /\b(?:it|test|describe|suite)[.\w]*\.only\s*\(/g,
  },
  {
    label: ".fixme",
    pattern: /\b(?:it|test|describe)[.\w]*\.fixme\s*\(/g,
  },
  { label: "xit", pattern: /\bxit\s*\(/g },
  { label: "xdescribe", pattern: /\bxdescribe\s*\(/g },
  { label: "fit", pattern: /\bfit\s*\(/g },
  { label: "fdescribe", pattern: /\bfdescribe\s*\(/g },
];

const count = (text: string, pattern: RegExp): number =>
  text.match(pattern)?.length ?? 0;

/**
 * Lists the suppression markers `after` has more of than `before`, so an edit
 * that only touches a line near an existing `// @ts-ignore` isn't flagged.
 */
export const findNewSuppressions = (before: string, after: string): string[] =>
  MARKERS.filter(
    ({ pattern }) => count(after, pattern) > count(before, pattern),
  ).map(({ label }) => label);
