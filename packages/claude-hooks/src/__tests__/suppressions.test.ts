import { describe, expect, it } from "vitest";
import { findNewSuppressions } from "../suppressions.ts";

describe("findNewSuppressions", () => {
  it.each([
    ["// eslint-disable-next-line no-console", "eslint-disable"],
    ["/* eslint-disable */", "eslint-disable"],
    ["// @ts-ignore", "@ts-ignore"],
    ["// @ts-nocheck", "@ts-nocheck"],
    ["// @ts-expect-error", "@ts-expect-error"],
    ['it.skip("works", () => {});', ".skip"],
    ['test.only("works", () => {});', ".only"],
    ['describe.skip("suite", () => {});', ".skip"],
    ['it.concurrent.only("works", () => {});', ".only"],
    ['test.fixme("flaky", async () => {});', ".fixme"],
    ['xit("works", () => {});', "xit"],
    ['fdescribe("suite", () => {});', "fdescribe"],
  ])("flags %s", (added, label) => {
    expect(findNewSuppressions("", added)).toEqual([label]);
  });

  it.each([
    'it("skips invalid rows", () => {});',
    "const only = true;",
    "array.skip(1)",
    "// see the eslint docs",
  ])("ignores %s", (added) => {
    expect(findNewSuppressions("", added)).toEqual([]);
  });

  it("only flags markers the edit added", () => {
    const before = "// @ts-ignore\nfoo();";
    expect(findNewSuppressions(before, "// @ts-ignore\nfoo(1);")).toEqual([]);
    expect(
      findNewSuppressions(before, "// @ts-ignore\n// @ts-ignore\nfoo();"),
    ).toEqual(["@ts-ignore"]);
  });

  it("lists each kind once", () => {
    expect(
      findNewSuppressions("", 'it.skip("a");\nit.skip("b");\n// @ts-ignore'),
    ).toEqual(["@ts-ignore", ".skip"]);
  });
});
