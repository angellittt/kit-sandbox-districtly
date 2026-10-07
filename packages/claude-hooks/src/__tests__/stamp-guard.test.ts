import { describe, expect, it } from "vitest";
import { findStampEdit, findStampWrite } from "../stamp-guard.ts";

describe("findStampWrite", () => {
  it.each([
    "echo abc > .git/preloop-pass",
    "echo abc >.git/preloop-pass",
    "echo abc>>.git/preloop-pass",
    "git rev-parse HEAD > .git/preloop-pass",
    "git rev-parse HEAD 1> .git/preloop-pass",
    "git rev-parse HEAD | tee .git/preloop-pass",
    "touch .git/preloop-pass",
    "cp /tmp/x .git/preloop-pass",
    "mv /tmp/x .git/preloop-pass",
    "sed -i s/a/b/ .git/preloop-pass",
    "node -e \"require('fs').writeFileSync('.git/preloop-pass', 'x')\"",
    "f=.git/preloop-pass; echo x > $f",
    "cat /tmp/x > '.git/preloop-''pass'",
    "git log -1 --format=%H --output=.git/preloop-pass",
    'bash -c "echo x > .git/preloop-pass"',
    "pnpm test && echo x > .git/preloop-pass",
  ])("blocks %s", (command) => {
    expect(findStampWrite(command)).toContain("pnpm ci:local");
  });

  it.each([
    "cat .git/preloop-pass",
    "ls -l .git/preloop-pass",
    "grep -rn preloop-pass scripts",
    "git rev-parse --git-path preloop-pass",
    'git commit -m "document the preloop-pass stamp"',
    "pnpm ci:local",
    "git push",
    "cat .git/preloop-pass > /tmp/copy",
  ])("allows %s", (command) => {
    expect(findStampWrite(command)).toBeNull();
  });
});

describe("findStampEdit", () => {
  it("blocks writing the stamp file", () => {
    expect(
      findStampEdit({ file_path: "/repo/.git/preloop-pass", content: "x" }),
    ).not.toBeNull();
    expect(
      findStampEdit({ file_path: "/repo/.git/worktrees/w/preloop-pass" }),
    ).not.toBeNull();
  });

  it("allows other files", () => {
    expect(findStampEdit({ file_path: "/repo/src/index.ts" })).toBeNull();
    expect(findStampEdit({ notebook_path: "/repo/a.ipynb" })).toBeNull();
    expect(findStampEdit(undefined)).toBeNull();
  });
});
