#!/usr/bin/env node
// Lists packages with flagged licenses in a CycloneDX SBOM, as a Markdown job
// summary: copyleft (GPL, AGPL, LGPL, SSPL) and source-available (BUSL).
// Also names packages with no license data. Warning only: it always exits 0.
// Whether a flagged license is a problem depends on the client contract, so
// blocking stays a per-project decision.
//
// Usage: licenses.mjs <sbom.cdx.json> --name <name> [--summary <file>]
//   Writes the summary to --summary (appends) or stdout.
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// BUSL isn't copyleft, but its production-use limits carry the same contract
// risk. Match BUSL, not BSL: BSL-1.0 is the permissive Boost license.
const FLAGGED = [
  /\b(AGPL|LGPL|GPL|SSPL|BUSL)\b/i,
  /GNU (Affero |Lesser |Library )?General Public License/i,
  /Server Side Public License/i,
  /Business Source License/i,
];

const licenseText = (component) =>
  (component.licenses ?? [])
    .map((l) => l.expression ?? l.license?.id ?? l.license?.name)
    .filter(Boolean)
    .join(", ");

const fullName = (c) => (c.group ? `${c.group}/${c.name}` : c.name);

// CycloneDX components can nest (e.g. workspace packages); check them all.
const flatten = (components = []) =>
  components.flatMap((c) => [c, ...flatten(c.components)]);

/**
 * @param {object} bom CycloneDX SBOM
 * @returns {{ name: string, version: string, license: string }[]} sorted by name
 */
export const flaggedComponents = (bom) => {
  const found = new Map();
  for (const c of flatten(bom.components)) {
    const license = licenseText(c);
    if (!FLAGGED.some((re) => re.test(license))) continue;
    const name = fullName(c);
    found.set(`${name}@${c.version}`, { name, version: c.version, license });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * @param {object} bom CycloneDX SBOM
 * @returns {{ name: string, version: string }[]} packages with no license data, sorted by name
 */
export const unlicensedComponents = (bom) => {
  const found = new Map();
  for (const c of flatten(bom.components)) {
    if (licenseText(c)) continue;
    const name = fullName(c);
    found.set(`${name}@${c.version}`, { name, version: c.version });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * @param {object} bom CycloneDX SBOM
 * @param {{ name: string }} options
 * @returns {string} Markdown
 */
export const licenseSummary = (bom, { name }) => {
  const found = flaggedComponents(bom);
  const unknown = unlicensedComponents(bom);
  const lines = [`### Flagged licenses: ${name}`, ""];

  if (!found.length) {
    lines.push("No flagged licenses found.");
  } else {
    lines.push(
      `${found.length} packages use a GPL, AGPL, LGPL, SSPL or BUSL license. Warning only, this never fails the build. Check them against the client contract. A package listed as \`MIT OR GPL-2.0\` can be used under MIT.`,
      "",
      "| Package | Version | License |",
      "| --- | --- | --- |",
      ...found.map((c) => `| ${c.name} | ${c.version} | ${c.license} |`),
    );
  }
  if (unknown.length) {
    const n = unknown.length;
    lines.push(
      "",
      `<details><summary>${n} ${n === 1 ? "package has" : "packages have"} no license data in the SBOM, so ${n === 1 ? "it isn't" : "they aren't"} checked. Review by hand.</summary>`,
      "",
      "| Package | Version |",
      "| --- | --- |",
      ...unknown.map((c) => `| ${c.name} | ${c.version} |`),
      "",
      "</details>",
    );
  }
  lines.push("");
  return lines.join("\n");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: "string", default: "sbom" },
      summary: { type: "string" },
    },
  });
  const [file] = positionals;
  if (!file) {
    console.error(
      "Usage: licenses.mjs <sbom.cdx.json> --name <name> [--summary <file>]",
    );
    process.exit(2);
  }

  const bom = JSON.parse(readFileSync(file, "utf8"));
  const md = licenseSummary(bom, { name: values.name });
  if (values.summary) appendFileSync(values.summary, `${md}\n`);
  else console.log(md);
  for (const c of flaggedComponents(bom)) {
    console.log(
      `::warning title=Flagged license::${c.name}@${c.version} uses ${c.license}`,
    );
  }
}
