#!/usr/bin/env node
// Checks the ignore list in a Grype config (.grype.yaml). Every entry needs a
// vulnerability ID, a package name, a CycloneDX VEX state (plus a
// justification when the state is not_affected), a reason and an expiry date
// that is neither past nor more than --max-days out. Forces each suppression
// to be re-reviewed instead of living forever.
//
// Grype itself uses vulnerability, package and reason. It ignores `state`,
// `justification` and `expires`, which only this check reads.
//
// Usage: suppressions.mjs <config.json> [--today YYYY-MM-DD] [--max-days N] [--warn-only]
//   config.json: the Grype config converted to JSON (yq -o=json .grype.yaml)
//   --max-days:  latest allowed expiry, in days from today (default 90)
//   --warn-only: print problems as warnings and exit 0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const VULN_ID = /^(CVE-\d{4}-\d{4,}|GHSA(-[a-z0-9]{4}){3})$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})/;

// CycloneDX 1.6 vulnerabilities[].analysis.state and .justification values.
const STATES = [
  "resolved",
  "resolved_with_pedigree",
  "exploitable",
  "in_triage",
  "false_positive",
  "not_affected",
];
const JUSTIFICATIONS = [
  "code_not_present",
  "code_not_reachable",
  "requires_configuration",
  "requires_dependency",
  "requires_environment",
  "protected_by_compiler",
  "protected_at_runtime",
  "protected_at_perimeter",
  "protected_by_mitigating_control",
];

export const DEFAULT_MAX_DAYS = 90;

// "2026-12-31" or a YAML timestamp read as "2026-12-31T00:00:00Z" -> "2026-12-31"
const toDate = (value) => {
  const m = typeof value === "string" ? DATE.exec(value) : null;
  if (!m) return null;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return date.getUTCMonth() + 1 === Number(m[2]) ? m[0].slice(0, 10) : null;
};

const isBlank = (value) => typeof value !== "string" || !value.trim();

const addDays = (ymd, n) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5)
    .toISOString()
    .slice(0, 10);

/**
 * @param {object | null} config Grype config as parsed from .grype.yaml
 * @param {string} today YYYY-MM-DD
 * @param {{ maxDays?: number }} [options]
 * @returns {string[]} one message per problem, empty when all entries are fine
 */
export const checkSuppressions = (
  config,
  today,
  { maxDays = DEFAULT_MAX_DAYS } = {},
) => {
  const latest = addDays(today, maxDays);
  const ignore = config?.ignore ?? [];
  if (!Array.isArray(ignore)) return ["`ignore` must be a list of entries."];

  return ignore.flatMap((entry, i) => {
    const id = VULN_ID.test(entry?.vulnerability ?? "")
      ? entry.vulnerability
      : null;
    const label = id ?? `entry ${i + 1}`;
    const problems = [];
    if (!id) problems.push("`vulnerability` must be a CVE or GHSA ID");
    if (isBlank(entry?.package?.name))
      problems.push("`package.name` is missing");
    const state = entry?.state;
    if (!STATES.includes(state))
      problems.push(`\`state\` must be one of ${STATES.join(", ")}`);
    if (
      state === "not_affected" &&
      !JUSTIFICATIONS.includes(entry?.justification)
    )
      problems.push(
        `\`justification\` must be one of ${JUSTIFICATIONS.join(", ")} when state is not_affected`,
      );
    if (isBlank(entry?.reason)) problems.push("`reason` is missing");
    const expires = toDate(entry?.expires);
    if (!expires) problems.push("`expires` must be a date (YYYY-MM-DD)");
    else if (expires < today) problems.push(`expired on ${expires}`);
    else if (expires > latest)
      problems.push(
        `expires more than ${maxDays} days out (${expires}, latest allowed ${latest})`,
      );
    return problems.map((p) => `${label}: ${p}`);
  });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      today: { type: "string", default: new Date().toISOString().slice(0, 10) },
      "max-days": { type: "string", default: String(DEFAULT_MAX_DAYS) },
      "warn-only": { type: "boolean", default: false },
    },
  });
  const [file] = positionals;
  const { today, "warn-only": warnOnly } = values;
  const maxDays = Number(values["max-days"]);
  if (!file || !Number.isInteger(maxDays) || maxDays < 1) {
    console.error(
      "Usage: suppressions.mjs <config.json> [--today YYYY-MM-DD] [--max-days N] [--warn-only]",
    );
    process.exit(2);
  }

  const config = JSON.parse(readFileSync(file, "utf8"));
  const problems = checkSuppressions(config, today, { maxDays });
  const count = config?.ignore?.length ?? 0;
  if (!problems.length) {
    console.log(`${count} suppression(s), all complete and unexpired.`);
    process.exit(0);
  }
  const level = warnOnly ? "warning" : "error";
  for (const p of problems)
    console.log(`::${level} title=Grype suppression::${p}`);
  console.log(
    "Fix or remove these entries in the Grype config. See SBOM.md > Suppressing a vulnerability.",
  );
  process.exit(warnOnly ? 0 : 1);
}
