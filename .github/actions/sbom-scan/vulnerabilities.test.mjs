// Run with: node --test ".github/actions/**/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { blockingMatches, summarize } from "./vulnerabilities.mjs";

const match = (id, severity, pkg, fixVersions = []) => ({
  vulnerability: {
    id,
    severity,
    dataSource: `https://github.com/advisories/${id}`,
    fix: {
      versions: fixVersions,
      state: fixVersions.length ? "fixed" : "not-fixed",
    },
  },
  artifact: { name: pkg, version: "1.0.0", type: "npm" },
});

const report = {
  matches: [
    match("CVE-1", "Critical", "a", ["1.0.1"]),
    match("CVE-2", "Critical", "b"),
    match("CVE-3", "High", "c", ["2.0.0"]),
    match("CVE-4", "Medium", "d", ["1.2.0"]),
    match("CVE-5", "Low", "e"),
    match("CVE-6", "Unknown", "f", ["1.0.2"]),
  ],
  ignoredMatches: [match("CVE-7", "Critical", "g", ["1.1.0"])],
};

const ids = (matches) => matches.map((m) => m.vulnerability.id);

test("fail-on critical with only-fixed blocks only fixable criticals", () => {
  assert.deepEqual(
    ids(blockingMatches(report, { failOn: "critical", onlyFixed: true })),
    ["CVE-1"],
  );
});

test("fail-on high includes everything at or above high", () => {
  assert.deepEqual(
    ids(blockingMatches(report, { failOn: "high", onlyFixed: true })),
    ["CVE-1", "CVE-3"],
  );
});

test("without only-fixed, unfixable matches block too", () => {
  assert.deepEqual(
    ids(blockingMatches(report, { failOn: "critical", onlyFixed: false })),
    ["CVE-1", "CVE-2"],
  );
});

test("fail-on none never blocks", () => {
  assert.deepEqual(blockingMatches(report, { failOn: "none" }), []);
  assert.deepEqual(blockingMatches(report, { failOn: "" }), []);
});

test("fail-on is case insensitive", () => {
  assert.deepEqual(
    ids(blockingMatches(report, { failOn: "CRITICAL", onlyFixed: true })),
    ["CVE-1"],
  );
});

test("an unknown fail-on value throws", () => {
  assert.throws(
    () => blockingMatches(report, { failOn: "severe" }),
    /fail-on must be one of/,
  );
});

test("suppressed matches never block", () => {
  const onlyIgnored = { matches: [], ignoredMatches: report.ignoredMatches };
  assert.deepEqual(
    blockingMatches(onlyIgnored, { failOn: "negligible", onlyFixed: false }),
    [],
  );
});

test("summary shows counts, the threshold, and the blocking list", () => {
  const md = summarize(report, {
    name: "source",
    failOn: "critical",
    onlyFixed: true,
  });
  assert.match(md, /### Vulnerability scan: source/);
  assert.match(md, /\| Critical \| 2 \| 1 \|/);
  assert.match(md, /\| High \| 1 \| 1 \|/);
  assert.match(md, /1 suppressed/);
  assert.match(md, /Fails on: \*\*critical\*\* and above, fixable only/);
  assert.match(md, /1 blocking/);
  assert.match(
    md,
    /\| Critical \| \[CVE-1\]\(https:\/\/github.com\/advisories\/CVE-1\) \| a \| 1\.0\.0 \| 1\.0\.1 \|/,
  );
});

test("summary lists every match, most severe first", () => {
  const md = summarize(report, { name: "x", failOn: "none" });
  const order = ["CVE-1", "CVE-2", "CVE-3", "CVE-4", "CVE-5", "CVE-6"].map(
    (id) => md.lastIndexOf(`[${id}]`),
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.match(md, /Report only, never fails/);
  assert.match(md, /\[CVE-2\].*\| not fixed \|/);
});

test("a clean report says so", () => {
  const md = summarize({ matches: [] }, { name: "x", failOn: "critical" });
  assert.match(md, /No vulnerabilities found/);
});
