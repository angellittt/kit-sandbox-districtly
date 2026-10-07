import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPostEdit } from "../post-edit.ts";

/** The real repo, so the hook runs the real Prettier, oxlint and ESLint. */
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

describe("runPostEdit with the real tools", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reports errors from rules that only oxlint runs", () => {
    dir = mkdtempSync(join(REPO_ROOT, "packages/claude-hooks/.tmp-"));
    const file = join(dir, "probe.ts");
    const content = "debugger;\nexport {};\n";
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from mkdtempSync above
    writeFileSync(file, content);

    const result = runPostEdit({
      tool_name: "Write",
      cwd: REPO_ROOT,
      tool_input: { file_path: file, content },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("oxlint failed");
    expect(result.stderr).toContain("no-debugger");
  }, 60_000);
});
