// Run with: node --test ".github/actions/**/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSuppressions } from "./suppressions.mjs";

const today = "2026-10-01";

const entry = (overrides = {}) => ({
  vulnerability: "CVE-2026-12345",
  package: { name: "lodash", version: "4.17.20" },
  state: "not_affected",
  justification: "code_not_reachable",
  reason: "Only reachable through a dev script, never shipped.",
  expires: "2026-12-15",
  ...overrides,
});

test("a complete, unexpired entry passes", () => {
  assert.deepEqual(checkSuppressions({ ignore: [entry()] }, today), []);
});

test("no config, or a config with no ignore list, passes", () => {
  assert.deepEqual(checkSuppressions(null, today), []);
  assert.deepEqual(checkSuppressions({}, today), []);
  assert.deepEqual(checkSuppressions({ ignore: [] }, today), []);
});

test("GHSA IDs are accepted as well as CVE IDs", () => {
  const ghsa = entry({ vulnerability: "GHSA-5xrq-8626-4rwp" });
  assert.deepEqual(checkSuppressions({ ignore: [ghsa] }, today), []);
});

test("an entry that expires today still passes", () => {
  const e = entry({ expires: today });
  assert.deepEqual(checkSuppressions({ ignore: [e] }, today), []);
});

test("an expired entry fails", () => {
  const problems = checkSuppressions(
    { ignore: [entry({ expires: "2026-09-30" })] },
    today,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /CVE-2026-12345/);
  assert.match(problems[0], /expired on 2026-09-30/);
});

test("each missing field is reported", () => {
  const cases = [
    [{ vulnerability: undefined }, /vulnerability/],
    [{ vulnerability: "not-an-id" }, /vulnerability/],
    [{ package: undefined }, /package\.name/],
    [{ package: { version: "1.0.0" } }, /package\.name/],
    [{ reason: undefined }, /reason/],
    [{ reason: "   " }, /reason/],
    [{ expires: undefined }, /expires/],
    [{ expires: "next year" }, /expires/],
    [{ expires: "2026-13-45" }, /expires/],
    [{ state: undefined }, /state/],
    [{ state: "ignored" }, /state/],
    [{ justification: undefined }, /justification/],
    [{ justification: "trust me" }, /justification/],
  ];
  for (const [overrides, pattern] of cases) {
    const problems = checkSuppressions({ ignore: [entry(overrides)] }, today);
    assert.equal(problems.length, 1, JSON.stringify(overrides));
    assert.match(problems[0], pattern);
  }
});

test("problems name the entry by position when it has no ID", () => {
  const problems = checkSuppressions(
    { ignore: [entry(), entry({ vulnerability: undefined })] },
    today,
  );
  assert.match(problems[0], /entry 2/);
});

test("a YAML timestamp read as a full ISO date still works", () => {
  const e = entry({ expires: "2026-12-15T00:00:00Z" });
  assert.deepEqual(checkSuppressions({ ignore: [e] }, today), []);
});

test("ignore must be a list", () => {
  const problems = checkSuppressions({ ignore: { a: 1 } }, today);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /list/);
});

test("justification is only required when state is not_affected", () => {
  const e = entry({ state: "exploitable", justification: undefined });
  assert.deepEqual(checkSuppressions({ ignore: [e] }, today), []);
});

test("an entry that expires exactly 90 days out passes", () => {
  const e = entry({ expires: "2026-12-30" });
  assert.deepEqual(checkSuppressions({ ignore: [e] }, today), []);
});

test("an entry that expires more than 90 days out fails", () => {
  const problems = checkSuppressions(
    { ignore: [entry({ expires: "2099-12-31" })] },
    today,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /more than 90 days out/);
  assert.match(problems[0], /latest allowed 2026-12-30/);
});

test("maxDays changes the limit", () => {
  const e = entry({ expires: "2026-12-15" });
  assert.equal(
    checkSuppressions({ ignore: [e] }, today, { maxDays: 30 }).length,
    1,
  );
  assert.deepEqual(
    checkSuppressions({ ignore: [e] }, today, { maxDays: 365 }),
    [],
  );
});
