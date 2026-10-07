import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const preBash = fileURLToPath(new URL("../bin/pre-bash.ts", import.meta.url));

const runHook = (input: unknown) =>
  spawnSync(process.execPath, [preBash], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });

describe("pre-bash hook (as Claude Code runs it)", () => {
  it("blocks a bypass with exit code 2 and the reason on stderr", () => {
    const result = runHook({
      tool_name: "Bash",
      tool_input: { command: "git commit --no-verify -m fix" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Bypassing checks is not allowed");
  });

  it("allows a normal commit", () => {
    const result = runHook({
      tool_name: "Bash",
      tool_input: { command: "git commit -m fix" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("does not get in the way on input it can't read", () => {
    expect(runHook("not json").status).toBe(0);
  });
});

const runner = fileURLToPath(
  new URL("../../../../.claude/hooks/run-hook.sh", import.meta.url),
);

/** Runs the wrapper with stdin never closed, so the hook waits forever for its input. */
const runWithoutInput = async (args: string[]) => {
  const child = spawn(runner, args);
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const status = await new Promise<number | null>((resolve) =>
    child.on("close", resolve),
  );
  return { status, stderr };
};

describe("run-hook.sh (the command in .claude/settings.json)", () => {
  it("runs the named hook", () => {
    const result = spawnSync(runner, ["pre-bash"], {
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "LEFTHOOK=0 git push" },
      }),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("LEFTHOOK=0");
  });

  it("blocks, with setup steps, when the hook can't run", () => {
    const result = spawnSync(runner, ["does-not-exist"], {
      input: "{}",
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("mise install");
  });

  it("blocks when the hook runs past its time limit", async () => {
    const { status, stderr } = await runWithoutInput(["pre-bash", "1"]);
    expect(status).toBe(2);
    expect(stderr).toContain("took longer than 1s");
    expect(stderr).toContain("this command was blocked");
  });

  it("says the edit went unchecked when the post-edit hook times out", async () => {
    const { status, stderr } = await runWithoutInput(["post-edit", "1"]);
    expect(status).toBe(2);
    expect(stderr).toContain("was not formatted or linted");
  });
});
