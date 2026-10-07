import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hook = (name: string) =>
  fileURLToPath(new URL(`../bin/${name}.ts`, import.meta.url));

let tmp = "";
let repo = "";
let fakeBin = "";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

const runHook = (name: string, input: unknown, withPreloop = true) =>
  spawnSync(process.execPath, [hook(name)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: withPreloop ? `${fakeBin}:/usr/bin:/bin` : "/usr/bin:/bin",
    },
  });

const push = (withPreloop = true) =>
  runHook(
    "pre-bash",
    { cwd: repo, tool_name: "Bash", tool_input: { command: "git push" } },
    withPreloop,
  );

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "push-gate-"));
  repo = join(tmp, "repo");
  fakeBin = join(tmp, "bin");
  execFileSync("mkdir", ["-p", repo, fakeBin]);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside the mkdtempSync dir above
  writeFileSync(join(fakeBin, "preloop"), "#!/bin/sh\nexit 0\n");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside the mkdtempSync dir above
  chmodSync(join(fakeBin, "preloop"), 0o755);
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside the mkdtempSync dir above
  writeFileSync(join(repo, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// Skipped while PUSH_GATE_ENABLED is false in bin/pre-bash.ts.
describe.skip("push gate (as Claude Code runs it)", () => {
  it("blocks git push until pnpm ci:local has passed", () => {
    const result = push();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("pnpm ci:local");
  });

  it("allows git push once the stamp matches a clean HEAD", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside the mkdtempSync dir above
    writeFileSync(
      join(repo, ".git/preloop-pass"),
      `${git("rev-parse", "HEAD")}\n`,
    );
    expect(push().status).toBe(0);
  });

  it("blocks again after a new commit", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside the mkdtempSync dir above
    writeFileSync(join(repo, "a.txt"), "b\n");
    git("commit", "-q", "-am", "next");
    expect(push().status).toBe(2);
  });

  it("blocks with setup steps when preloop isn't on PATH", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside the mkdtempSync dir above
    writeFileSync(join(repo, ".git/preloop-pass"), git("rev-parse", "HEAD"));
    const result = push(false);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("mise install");
  });
});

describe("pre-bash hook", () => {
  it("blocks writing the stamp from Bash", () => {
    const result = runHook("pre-bash", {
      cwd: repo,
      tool_input: { command: "git rev-parse HEAD > .git/preloop-pass" },
    });
    expect(result.status).toBe(2);
  });
});

describe("pre-edit hook", () => {
  it("blocks Write on the stamp file", () => {
    const result = runHook("pre-edit", {
      tool_name: "Write",
      tool_input: { file_path: join(repo, ".git/preloop-pass"), content: "x" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("pnpm ci:local");
  });

  it("allows other edits", () => {
    const result = runHook("pre-edit", {
      tool_name: "Edit",
      tool_input: { file_path: join(repo, "a.txt") },
    });
    expect(result.status).toBe(0);
  });
});
