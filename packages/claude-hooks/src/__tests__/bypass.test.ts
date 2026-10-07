import { describe, expect, it } from "vitest";
import { findBypass } from "../bypass.ts";

describe("findBypass", () => {
  it.each([
    "git commit --no-verify -m fix",
    "git commit -n -m fix",
    "git commit -nm fix",
    "git commit -anm fix",
    "git push --no-verify",
    "git push origin main --no-verify",
    "git -C apps/web commit --no-verify -m fix",
    "git -c user.name=bot commit -n -m fix",
    "pnpm lint && git commit --no-verify -m fix",
    "git add . ; git commit -n -m 'fix'",
    "LEFTHOOK=0 git commit -m fix",
    "LEFTHOOK=false git push",
    "LEFTHOOK_EXCLUDE=test git commit -m fix",
    "HUSKY=0 git commit -m fix",
    "env LEFTHOOK=0 git push",
    "export LEFTHOOK=0 && git commit -m fix",
    "git -c core.hooksPath=/dev/null commit -m fix",
    "git config core.hooksPath /tmp/empty",
    "git config --unset core.hooksPath",
    "pnpm exec lefthook uninstall",
    'bash -c "git commit --no-verify -m fix"',
    "git merge --no-verify feature",
    "git commit --no-veri -m fix",
    "git push --no-v",
    'git -c alias.c="commit --no-verify" c -m fix',
  ])("blocks %s", (command) => {
    expect(findBypass(command)).not.toBeNull();
  });

  it.each([
    "git commit -m fix",
    "git commit -am fix",
    "git commit -m 'mention --no-verify in the message'",
    'git commit -m "-n is not a flag here"',
    "git commit -m -n",
    "git push -n",
    "git push --dry-run",
    "git status",
    "LEFTHOOK=1 git commit -m fix",
    "git config core.hooksPath",
    "git config --get core.hooksPath",
    "grep -rn no-verify Readme.md",
    "echo LEFTHOOK=0",
    "pnpm exec lefthook install",
    "git log -n 5",
    "git commit --no-edit",
    "git add -- --no-verify",
  ])("allows %s", (command) => {
    expect(findBypass(command)).toBeNull();
  });

  it("explains how to fix instead of bypassing", () => {
    expect(findBypass("git commit --no-verify -m fix")).toMatch(
      /Bypassing checks is not allowed/,
    );
  });
});
