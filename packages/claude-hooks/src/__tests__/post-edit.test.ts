import { describe, expect, it } from "vitest";
import { runPostEdit, type Runner } from "../post-edit.ts";

const ROOT = "/repo";

interface Call {
  command: string;
  args: string[];
  cwd: string;
}

const fakeRunner = (
  results: Record<string, { status: number; output: string }> = {},
) => {
  const calls: Call[] = [];
  const run: Runner = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (command === "git") return { status: 0, output: `${ROOT}\n` };
    const name = command.split("/").pop() ?? command;
    return (
      new Map(Object.entries(results)).get(name) ?? { status: 0, output: "" }
    );
  };
  return { run, calls };
};

const deps = (runner: ReturnType<typeof fakeRunner>) => ({
  run: runner.run,
  exists: () => true,
});

const edit = (filePath: string, oldString = "a", newString = "b") => ({
  tool_name: "Edit",
  tool_input: {
    file_path: filePath,
    old_string: oldString,
    new_string: newString,
  },
});

describe("runPostEdit", () => {
  it("formats and lints a TypeScript file from the repo root", () => {
    const runner = fakeRunner();
    const result = runPostEdit(edit(`${ROOT}/apps/web/src/a.ts`), deps(runner));

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const tools = runner.calls.filter((call) => call.command !== "git");
    expect(tools.map((call) => call.command)).toEqual([
      `${ROOT}/node_modules/.bin/prettier`,
      `${ROOT}/node_modules/.bin/oxlint`,
      `${ROOT}/node_modules/.bin/eslint`,
    ]);
    expect(tools.every((call) => call.cwd === ROOT)).toBe(true);
    expect(tools[0]?.args).toContain("--write");
    expect(tools[1]?.args).toEqual([
      "--max-warnings=0",
      `${ROOT}/apps/web/src/a.ts`,
    ]);
    expect(tools[2]?.args).toEqual([
      "--max-warnings=0",
      "--no-warn-ignored",
      `${ROOT}/apps/web/src/a.ts`,
    ]);
  });

  it("only formats files the linters don't handle", () => {
    const runner = fakeRunner();
    runPostEdit(edit(`${ROOT}/Readme.md`), deps(runner));
    const tools = runner.calls.filter((call) => call.command !== "git");
    expect(tools.map((call) => call.command.split("/").pop())).toEqual([
      "prettier",
    ]);
  });

  it("shows lint errors to Claude and exits 2", () => {
    const runner = fakeRunner({
      eslint: { status: 1, output: "1:1 error  'x' is never used" },
    });
    const result = runPostEdit(edit(`${ROOT}/apps/api/src/a.ts`), deps(runner));

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("'x' is never used");
    expect(result.stderr).toContain("apps/api/src/a.ts");
  });

  it("shows oxlint errors to Claude and exits 2", () => {
    const runner = fakeRunner({
      oxlint: {
        status: 1,
        output: "eslint(no-debugger): `debugger` statement",
      },
    });
    const result = runPostEdit(edit(`${ROOT}/apps/web/src/a.ts`), deps(runner));

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("oxlint failed");
    expect(result.stderr).toContain("no-debugger");
  });

  it("shows format errors (e.g. a syntax error) to Claude", () => {
    const runner = fakeRunner({
      prettier: { status: 2, output: "SyntaxError: Unexpected token" },
    });
    const result = runPostEdit(edit(`${ROOT}/a.json`), deps(runner));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("SyntaxError");
  });

  it("warns, without blocking, about new suppressions", () => {
    const runner = fakeRunner();
    const result = runPostEdit(
      edit(`${ROOT}/apps/web/src/a.test.ts`, "it(", "it.skip("),
      deps(runner),
    );

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(output.hookSpecificOutput.additionalContext).toMatch(
      /\.skip.*justify or remove/is,
    );
  });

  it("includes the warning along with lint errors", () => {
    const runner = fakeRunner({ eslint: { status: 1, output: "boom" } });
    const result = runPostEdit(
      edit(`${ROOT}/a.ts`, "x", "// @ts-ignore\nx"),
      deps(runner),
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("boom");
    expect(result.stderr).toContain("@ts-ignore");
  });

  it("checks every edit of a MultiEdit and the content of a Write", () => {
    const multi = runPostEdit(
      {
        tool_name: "MultiEdit",
        tool_input: {
          file_path: `${ROOT}/a.ts`,
          edits: [
            { old_string: "a", new_string: "b" },
            { old_string: "c", new_string: "test.only(" },
          ],
        },
      },
      deps(fakeRunner()),
    );
    expect(multi.stdout).toContain(".only");

    const write = runPostEdit(
      {
        tool_name: "Write",
        tool_input: {
          file_path: `${ROOT}/a.ts`,
          content: "/* eslint-disable */",
        },
      },
      deps(fakeRunner()),
    );
    expect(write.stdout).toContain("eslint-disable");
  });

  it("does nothing for files outside a git repo", () => {
    const runner = fakeRunner();
    const run: Runner = (command, args, cwd) =>
      command === "git"
        ? { status: 128, output: "not a git repository" }
        : runner.run(command, args, cwd);

    const result = runPostEdit(edit("/tmp/scratch.ts"), {
      run,
      exists: () => true,
    });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(runner.calls).toEqual([]);
  });

  it("asks for pnpm install when the tools are missing", () => {
    const result = runPostEdit(edit(`${ROOT}/a.ts`), {
      run: fakeRunner().run,
      exists: (path) => !path.includes("node_modules"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("pnpm install");
  });

  it("ignores tools other than Edit, MultiEdit and Write", () => {
    const runner = fakeRunner();
    const result = runPostEdit(
      { tool_name: "Read", tool_input: { file_path: `${ROOT}/a.ts` } },
      deps(runner),
    );
    expect(result.exitCode).toBe(0);
    expect(runner.calls).toEqual([]);
  });
});
