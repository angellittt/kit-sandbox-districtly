#!/usr/bin/env node
// Turns a Grype JSON report into a Markdown job summary, and decides whether
// the scan fails. Same rule as `grype --fail-on <severity> --only-fixed`, but
// the summary still lists unfixable matches so nothing is hidden.
//
// Usage: vulnerabilities.mjs <grype-report.json> --name <name>
//          [--fail-on <severity>|none] [--only-fixed true|false]
//          [--summary <file>]
//   Writes the summary to --summary (appends) or stdout. Exits 1 when a
//   blocking match is found, 2 on bad arguments.
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Grype's severity order, lowest first. "Unknown" ranks below all of them.
const SEVERITIES = ["negligible", "low", "medium", "high", "critical"];
const MAX_ROWS = 200;

const rank = (severity) => SEVERITIES.indexOf(String(severity).toLowerCase());
const isFixed = (m) => m.vulnerability.fix?.state === "fixed";
const bySeverity = (a, b) =>
  rank(b.vulnerability.severity) - rank(a.vulnerability.severity);

const parseFailOn = (failOn) => {
  const value = String(failOn ?? "").toLowerCase();
  if (value === "" || value === "none") return null;
  if (!SEVERITIES.includes(value)) {
    throw new Error(
      `fail-on must be one of ${SEVERITIES.join(", ")} or none (got "${failOn}")`,
    );
  }
  return value;
};

/**
 * Matches that fail the scan. Suppressed matches (ignoredMatches) never count.
 * @param {object} report Grype JSON report
 * @param {{ failOn?: string, onlyFixed?: boolean }} options
 */
export const blockingMatches = (report, { failOn, onlyFixed = true }) => {
  const threshold = parseFailOn(failOn);
  if (!threshold) return [];
  return (report.matches ?? [])
    .filter((m) => rank(m.vulnerability.severity) >= rank(threshold))
    .filter((m) => !onlyFixed || isFixed(m));
};

const title = (severity) =>
  severity.charAt(0).toUpperCase() + severity.slice(1);

const row = (m) => {
  const v = m.vulnerability;
  const id = v.dataSource ? `[${v.id}](${v.dataSource})` : v.id;
  const fix = isFixed(m) ? v.fix.versions.join(", ") : "not fixed";
  return `| ${v.severity} | ${id} | ${m.artifact.name} | ${m.artifact.version} | ${fix} |`;
};

const table = (matches) => [
  "| Severity | ID | Package | Version | Fixed in |",
  "| --- | --- | --- | --- | --- |",
  ...matches.slice(0, MAX_ROWS).map(row),
  ...(matches.length > MAX_ROWS
    ? [`\n_${matches.length - MAX_ROWS} more not shown. See the JSON report._`]
    : []),
];

/**
 * @param {object} report Grype JSON report
 * @param {{ name: string, failOn?: string, onlyFixed?: boolean }} options
 * @returns {string} Markdown
 */
export const summarize = (report, { name, failOn, onlyFixed = true }) => {
  const matches = [...(report.matches ?? [])].sort(bySeverity);
  const suppressed = report.ignoredMatches?.length ?? 0;
  const threshold = parseFailOn(failOn);
  const blocking = blockingMatches(report, { failOn, onlyFixed }).sort(
    bySeverity,
  );

  const lines = [`### Vulnerability scan: ${name}`, ""];
  lines.push(
    threshold
      ? `Fails on: **${threshold}** and above${onlyFixed ? ", fixable only" : ""}.`
      : "Report only, never fails.",
  );
  lines.push("");

  if (!matches.length) {
    lines.push(`No vulnerabilities found (${suppressed} suppressed).`, "");
    return lines.join("\n");
  }

  lines.push("| Severity | Found | Fixable |", "| --- | --- | --- |");
  for (const severity of [...SEVERITIES, "unknown"].reverse()) {
    const found = matches.filter(
      (m) => String(m.vulnerability.severity).toLowerCase() === severity,
    );
    if (found.length) {
      lines.push(
        `| ${title(severity)} | ${found.length} | ${found.filter(isFixed).length} |`,
      );
    }
  }
  lines.push("", `${matches.length} found, ${suppressed} suppressed.`, "");

  if (threshold) {
    lines.push(
      blocking.length
        ? `**${blocking.length} blocking.** Upgrade these packages, or suppress with a reason in the Grype config (see SBOM.md).`
        : "0 blocking.",
      "",
    );
    if (blocking.length) lines.push(...table(blocking), "");
  }

  lines.push(
    "<details><summary>All findings</summary>",
    "",
    ...table(matches),
    "",
    "</details>",
    "",
  );
  return lines.join("\n");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: "string", default: "sbom" },
      "fail-on": { type: "string", default: "none" },
      "only-fixed": { type: "string", default: "true" },
      summary: { type: "string" },
    },
  });
  const [file] = positionals;
  if (!file) {
    console.error(
      "Usage: vulnerabilities.mjs <grype-report.json> --name <name> [--fail-on <severity>|none] [--only-fixed true|false] [--summary <file>]",
    );
    process.exit(2);
  }

  const report = JSON.parse(readFileSync(file, "utf8"));
  const options = {
    name: values.name,
    failOn: values["fail-on"],
    onlyFixed: values["only-fixed"] !== "false",
  };
  let blocking;
  try {
    blocking = blockingMatches(report, options);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const md = summarize(report, options);
  if (values.summary) appendFileSync(values.summary, `${md}\n`);
  else console.log(md);

  for (const m of blocking) {
    console.log(
      `::error title=Vulnerability ${m.vulnerability.id}::${m.vulnerability.severity} in ${m.artifact.name}@${m.artifact.version}, fixed in ${m.vulnerability.fix.versions.join(", ")}`,
    );
  }
  process.exit(blocking.length ? 1 : 0);
}
