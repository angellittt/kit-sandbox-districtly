import { describe, expect, it } from "vitest";
import { findUnverifiedPush, type GateEnv } from "../push-gate.ts";

const HEAD = "a".repeat(40);

interface FakeRepo {
  head?: string;
  /** The checked-out branch; null when HEAD is detached. */
  branch?: string | null;
  stamp?: string | null;
  status?: string;
}

/** A fake machine with Preloop installed and one repo per directory. */
const fakeEnv = (
  repos: Record<string, FakeRepo>,
  hasPreloop = true,
): GateEnv & { gitDirs: string[] } => {
  const gitDirs: string[] = [];
  return {
    gitDirs,
    hasPreloop: () => hasPreloop,
    git: (dir, args) => {
      gitDirs.push(dir);
      // eslint-disable-next-line security/detect-object-injection -- dir is a key of the test's own fixture
      const repo = repos[dir];
      if (repo === undefined) return null;
      if (args[0] === "status") return repo.status ?? "";
      if (args[0] === "symbolic-ref") {
        return repo.branch === undefined ? "feat/x" : repo.branch;
      }
      if (args.includes("--git-path")) return ".git/preloop-pass";
      return repo.head ?? HEAD;
    },
    readFile: (path) => {
      const dir = path.replace(/\/\.git\/preloop-pass$/, "");
      // eslint-disable-next-line security/detect-object-injection -- dir is a key of the test's own fixture
      return repos[dir]?.stamp ?? null;
    },
  };
};

const passed = fakeEnv({ "/repo": { stamp: `${HEAD}\n` } });

describe("findUnverifiedPush", () => {
  it.each([
    "git push",
    "git push origin feat/x",
    "git push -u origin HEAD",
    "gh pr create --fill",
    "gh pr create --draft --title x",
    "gh pr new --fill",
    "pnpm lint && git push",
    "git -C /repo push",
    "cd /repo && git push",
    "preloop run -f ci.yml --push",
    "preloop run -f ci.yml --create-pr",
    "preloop push",
    "git push origin HEAD:refs/heads/feat/x",
    "git push --force-with-lease origin +feat/x",
    "git push origin refs/heads/feat/x:feat/y",
    "git push -o ci.skip origin feat/x",
    "git push origin --delete old-branch",
    "gh api -X POST repos/o/r/pulls -f head=x -f base=main",
    "gh api --method=POST repos/o/r/pulls",
  ])("allows %s when the stamp matches a clean HEAD", (command) => {
    expect(findUnverifiedPush(command, "/repo", passed)).toBeNull();
  });

  it.each([
    "git status",
    "git commit -m push",
    "gh pr view",
    "pnpm ci:local",
    "gh api repos/o/r/pulls",
    "gh api -X PATCH repos/o/r/pulls/5 -f title=x",
    "gh api repos/o/r/issues -f title=x",
  ])("ignores %s", (command) => {
    const env = fakeEnv({}, false);
    expect(findUnverifiedPush(command, "/repo", env)).toBeNull();
  });

  it.each([
    ["git push origin other-branch:main", "other-branch:main"],
    ["git push --all origin", "--all"],
    ["git push --mirror origin", "--mirror"],
    ["git push --tags", "--tags"],
    ["git push origin HEAD~5:refs/heads/x", "HEAD~5:refs/heads/x"],
    ["git push origin v1.0.0", "v1.0.0"],
    ["git push origin feat/x other", "other"],
  ])(
    "blocks %s even with a valid stamp: it can push more than HEAD",
    (command, culprit) => {
      const reason = findUnverifiedPush(command, "/repo", passed);
      expect(reason).toContain(
        `\`${culprit}\` could push commits other than HEAD`,
      );
    },
  );

  it("allows only HEAD as a refspec source when HEAD is detached", () => {
    const env = fakeEnv({ "/repo": { stamp: HEAD, branch: null } });
    expect(
      findUnverifiedPush("git push origin HEAD:x", "/repo", env),
    ).toBeNull();
    expect(
      findUnverifiedPush("git push origin feat/x", "/repo", env),
    ).toContain("other than HEAD");
  });

  it.each(["git -c alias.p=push p", "git -c 'alias.p=!git push' p"])(
    "blocks a push through a -c alias: %s",
    (command) => {
      expect(findUnverifiedPush(command, "/repo", passed)).toContain(
        "`-c alias.*` that pushes",
      );
    },
  );

  it.each([
    "gh api repos/o/r/pulls -f head=x -f base=main",
    "gh api repos/o/r/pulls --input body.json",
    "gh api graphql -f query='mutation { createPullRequest(input: {}) { clientMutationId } }'",
  ])("gates PR creation through gh api: %s", (command) => {
    const env = fakeEnv({ "/repo": { stamp: null } });
    expect(findUnverifiedPush(command, "/repo", env)).toContain(
      "`gh api (create PR)` is blocked",
    );
  });

  it("blocks with no stamp and says how to fix it", () => {
    const env = fakeEnv({ "/repo": { stamp: null } });
    const reason = findUnverifiedPush("git push", "/repo", env);
    expect(reason).toContain("No local CI pass for this commit");
    expect(reason).toContain("pnpm ci:local");
  });

  it("blocks preloop push with no stamp", () => {
    const env = fakeEnv({ "/repo": { stamp: null } });
    const reason = findUnverifiedPush("preloop push", "/repo", env);
    expect(reason).toContain("`preloop push` is blocked");
  });

  it("blocks when the stamp is for an older commit", () => {
    const env = fakeEnv({ "/repo": { stamp: "b".repeat(40) } });
    expect(findUnverifiedPush("gh pr create", "/repo", env)).toContain(
      "not HEAD",
    );
  });

  it("blocks when the working tree has uncommitted changes", () => {
    const env = fakeEnv({ "/repo": { stamp: HEAD, status: " M a.ts" } });
    expect(findUnverifiedPush("git push", "/repo", env)).toContain(
      "uncommitted changes",
    );
  });

  it("blocks a push chained after a commit (HEAD isn't stamped yet)", () => {
    const env = fakeEnv({ "/repo": { stamp: null, status: "M  a.ts" } });
    expect(
      findUnverifiedPush("git commit -m x && git push", "/repo", env),
    ).not.toBeNull();
  });

  it("blocks with setup steps when Preloop isn't installed", () => {
    const env = fakeEnv({ "/repo": { stamp: HEAD } }, false);
    const reason = findUnverifiedPush("git push", "/repo", env);
    expect(reason).toContain("Preloop isn't installed");
    expect(reason).toContain("mise install");
    expect(reason).toContain("preloop setup github --via pat");
    expect(reason).toContain("80GB");
  });

  it("checks the repo that `git -C` points at", () => {
    const env = fakeEnv({ "/repo": { stamp: HEAD }, "/other": {} });
    expect(findUnverifiedPush("git -C ../other push", "/repo", env)).toContain(
      "No local CI pass",
    );
    expect(env.gitDirs).toContain("/other");
  });

  it("checks the repo a `cd` moves to", () => {
    const env = fakeEnv({ "/repo": { stamp: HEAD }, "/other": {} });
    expect(findUnverifiedPush("cd /other && git push", "/repo", env)).toContain(
      "No local CI pass",
    );
  });

  it("finds a push inside bash -c", () => {
    const env = fakeEnv({ "/repo": {} });
    expect(
      findUnverifiedPush('bash -c "git push origin x"', "/repo", env),
    ).not.toBeNull();
  });

  it("blocks when the git state can't be read", () => {
    expect(findUnverifiedPush("git push", "/nowhere", passed)).toContain(
      "Couldn't read the git state",
    );
  });
});
