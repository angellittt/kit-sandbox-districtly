import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expandCommands, type SimpleCommand } from "./shell.ts";

/** Written by scripts/ci-local/ci-local.sh under .git/ when every PR workflow passes. */
export const STAMP_NAME = "preloop-pass";

const SETUP_STEPS =
  "Preloop setup (ask the developer, it's needed by anyone who uses an AI agent in this repo): " +
  "1. `mise install` (Preloop is pinned in mise.toml). " +
  "2. `preloop setup github --via pat --repo <owner>/<repo>` with a fine-grained PAT. " +
  "3. About 80GB of free disk for the runner VM image. " +
  'See "Local CI with Preloop" in the Readme.';

const RUN_IT =
  "Run `pnpm ci:local`, fix any failures, commit, then push (as its own command, not chained after the commit). " +
  "If `pnpm ci:local` says Preloop or its GitHub auth isn't set up, stop and ask the developer to follow the setup steps it prints.";

/** What the gate needs to know about the machine, so tests can fake it. */
export interface GateEnv {
  hasPreloop: () => boolean;
  /** Runs git in `dir`; null when git fails. */
  git: (dir: string, args: string[]) => string | null;
  readFile: (path: string) => string | null;
}

export const realGateEnv: GateEnv = {
  hasPreloop: () =>
    spawnSync("preloop", ["version"], { stdio: "ignore" }).status === 0,
  git: (dir, args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : null;
  },
  readFile: (path) => {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the stamp file git reports via --git-path
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

/** Git options (before the subcommand) that take a separate value. */
const GIT_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

/** `git push` options that take a separate value. */
const PUSH_OPTIONS_WITH_VALUE = new Set([
  "-o",
  "--push-option",
  "--repo",
  "--receive-pack",
  "--exec",
]);

/** `git push` options that push refs other than the current branch. */
const PUSH_MANY_REFS = new Set(["--all", "--branches", "--mirror", "--tags"]);

const basename = (program: string): string =>
  program.split("/").pop() ?? program;

interface GatedAction {
  label: string;
  /** The directory it acts on (`git -C <dir>` moves it). */
  dir: string;
  /** For `git push`: the arguments after `push`. */
  pushArgs?: string[];
  /** Set when the command is blocked whatever the stamp says. */
  blocked?: string;
}

/** `gh api` that creates a PR: a write to `.../pulls`, or a GraphQL createPullRequest. */
const ghApiCreatesPr = (args: string[]): boolean => {
  const methodAt = args.findIndex((arg) => arg === "-X" || arg === "--method");
  const method =
    methodAt === -1
      ? args.find((arg) => arg.startsWith("--method="))?.slice(9)
      : args.at(methodAt + 1);
  const sendsFields = args.some((arg) =>
    /^(-[fF]|--field|--raw-field|--input)(=|$)|^-[fF]./.test(arg),
  );
  const writes =
    method === undefined ? sendsFields : method.toUpperCase() !== "GET";
  const pulls = args.some((arg) => /(^|\/)pulls\/?$/.test(arg));
  const graphql =
    args.includes("graphql") &&
    args.some((arg) => arg.includes("createPullRequest"));
  return (pulls && writes) || graphql;
};

/** If `argv` pushes code or opens a PR, describes it, else null. */
const gatedAction = (argv: string[], dir: string): GatedAction | null => {
  const [program = "", ...args] = argv;
  const name = basename(program);

  if (name === "git") {
    let i = 0;
    let gitDir = dir;
    let pushAlias = false;
    while (i < args.length && (args.at(i) ?? "").startsWith("-")) {
      const option = args.at(i) ?? "";
      if (GIT_OPTIONS_WITH_VALUE.has(option)) {
        i++;
        const value = args.at(i) ?? "";
        if (option === "-C") gitDir = resolve(gitDir, value);
        // `git -c alias.p=push p` pushes under another name.
        if (option === "-c" && /^alias\.[^=]*=.*\bpush\b/.test(value)) {
          pushAlias = true;
        }
      }
      i++;
    }
    if (pushAlias) {
      return {
        label: "git push",
        dir: gitDir,
        blocked:
          "`git push` is blocked: it runs through a `-c alias.*` that pushes. Run `git push` itself.",
      };
    }
    return args.at(i) === "push"
      ? { label: "git push", dir: gitDir, pushArgs: args.slice(i + 1) }
      : null;
  }

  if (name === "gh") {
    if (args.at(0) === "api") {
      return ghApiCreatesPr(args) ? { label: "gh api (create PR)", dir } : null;
    }
    const pr = args.indexOf("pr");
    const sub = pr === -1 ? undefined : args.at(pr + 1);
    return sub === "create" || sub === "new"
      ? { label: "gh pr create", dir }
      : null;
  }

  if (name === "preloop" && args.at(0) === "push") {
    return { label: "preloop push", dir };
  }
  if (name === "preloop" && args.at(0) === "run") {
    return args.some((arg) => /^--(push|create-pr)(=|$)/.test(arg))
      ? { label: "preloop run --push", dir }
      : null;
  }
  return null;
};

/**
 * If `pushArgs` could push commits other than HEAD, returns the argument that
 * does it, else null. The stamp only vouches for HEAD, so an agent may push
 * HEAD or the current branch (`git push`, `git push origin HEAD`,
 * `git push -u origin feat/x`), or delete a remote branch, and nothing else.
 */
const otherRefsPushed = (
  pushArgs: string[],
  branch: string | null,
): string | null => {
  const positional: string[] = [];
  for (let i = 0; i < pushArgs.length; i++) {
    const arg = pushArgs.at(i) ?? "";
    if (arg === "--") {
      positional.push(...pushArgs.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    // Deleting a remote branch pushes no commits.
    if (arg === "-d" || arg === "--delete") return null;
    if (PUSH_MANY_REFS.has(arg)) return arg;
    if (PUSH_OPTIONS_WITH_VALUE.has(arg)) i++;
  }
  const allowed = new Set(["HEAD", "@"]);
  if (branch !== null) {
    allowed.add(branch);
    allowed.add(`refs/heads/${branch}`);
  }
  // positional[0] is the remote; the rest are refspecs like `src:dst`.
  for (const refspec of positional.slice(1)) {
    const source = refspec.replace(/^\+/, "").split(":")[0] ?? "";
    if (source !== "" && !allowed.has(source)) return refspec;
  }
  return null;
};

/** Why a push from `dir` isn't allowed yet, or null if it is. */
const checkStamp = (dir: string, env: GateEnv): string | null => {
  const head = env.git(dir, ["rev-parse", "HEAD"]);
  const stampPath = env.git(dir, ["rev-parse", "--git-path", STAMP_NAME]);
  const status = env.git(dir, ["status", "--porcelain"]);
  if (head === null || stampPath === null || status === null) {
    return `Couldn't read the git state in ${dir}.`;
  }
  if (status !== "") {
    return "The working tree has uncommitted changes, so what would be pushed isn't what ran locally.";
  }
  const stamp = env.readFile(resolve(dir, stampPath))?.trim();
  if (stamp === undefined || stamp === "") {
    return "No local CI pass for this commit.";
  }
  if (stamp !== head) {
    return `The last local CI pass was for ${stamp.slice(0, 12)}, not HEAD (${head.slice(0, 12)}).`;
  }
  return null;
};

/**
 * Returns a message explaining why `command` may not push or open a PR yet,
 * or null. An agent can only push once `pnpm ci:local` has passed every
 * pull_request workflow for the exact commit being pushed, on a clean tree.
 * Used by the PreToolUse hook on Bash.
 */
export const findUnverifiedPush = (
  command: string,
  cwd: string,
  env: GateEnv = realGateEnv,
): string | null => {
  let dir = cwd;
  const commands: SimpleCommand[] = expandCommands(command);
  for (const { argv } of commands) {
    // Follow `cd <dir> && git push`.
    if (argv.at(0) === "cd" && argv.length === 2) {
      dir = resolve(dir, argv.at(1) ?? "");
      continue;
    }
    const action = gatedAction(argv, dir);
    if (action === null) continue;
    if (action.blocked !== undefined) return action.blocked;

    if (!env.hasPreloop()) {
      return `\`${action.label}\` is blocked: Preloop isn't installed, so CI can't run locally first. ${SETUP_STEPS}`;
    }
    if (action.pushArgs !== undefined) {
      const branch = env.git(action.dir, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
      const other = otherRefsPushed(action.pushArgs, branch);
      if (other !== null) {
        return `\`git push\` is blocked: \`${other}\` could push commits other than HEAD, and the local CI pass only covers HEAD. Push HEAD or the current branch only (\`git push\` or \`git push origin HEAD\`), or ask the developer to push the rest.`;
      }
    }
    const reason = checkStamp(action.dir, env);
    if (reason !== null) {
      return `\`${action.label}\` is blocked until every PR check passes locally. ${reason} ${RUN_IT}`;
    }
  }
  return null;
};
