import { expandCommands, type SimpleCommand } from "./shell.ts";

const FIX_IT =
  "Bypassing checks is not allowed. Fix the failing check and commit again. " +
  "If the failure is in code you don't own, stop and ask the developer.";

/** Env vars that turn git hooks off (Lefthook, plus Husky for old clones). */
const isHookDisablingAssignment = (assignment: string): boolean => {
  const [name = "", value = ""] = assignment.split(/=(.*)/s);
  if (name === "LEFTHOOK" || name === "HUSKY") {
    return value === "0" || value.toLowerCase() === "false";
  }
  // Skips hook jobs by tag or name.
  return name === "LEFTHOOK_EXCLUDE";
};

/** Git options (before the subcommand) that take a separate value. */
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

/** `git commit` short options whose value can follow as the next token. */
const COMMIT_SHORT_OPTIONS_WITH_VALUE = new Set(["m", "F", "C", "c", "t"]);

const COMMIT_LONG_OPTIONS_WITH_VALUE = new Set([
  "--message",
  "--file",
  "--author",
  "--date",
  "--template",
  "--reuse-message",
  "--reedit-message",
  "--fixup",
  "--squash",
  "--trailer",
  "--cleanup",
  "--pathspec-from-file",
]);

const mentionsHooksPath = (text: string): boolean =>
  text.toLowerCase().includes("core.hookspath");

/**
 * Git accepts any unambiguous prefix of a long option, so `--no-veri` and
 * `--no-v` also mean `--no-verify`.
 */
const isNoVerify = (arg: string): boolean =>
  arg.length >= "--no-v".length && "--no-verify".startsWith(arg);

/** True when `git commit` args contain `-n` (short for `--no-verify`). */
const commitSkipsHooks = (args: string[]): boolean => {
  for (let i = 0; i < args.length; i++) {
    const arg = args.at(i) ?? "";
    if (arg === "--") return false;
    if (arg.startsWith("--")) {
      if (COMMIT_LONG_OPTIONS_WITH_VALUE.has(arg)) i++;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") continue;

    // A cluster like `-anm`: flags until the first one that takes a value.
    for (let j = 1; j < arg.length; j++) {
      const flag = arg.charAt(j);
      if (flag === "n") return true;
      if (COMMIT_SHORT_OPTIONS_WITH_VALUE.has(flag)) {
        if (j === arg.length - 1) i++;
        break;
      }
    }
  }
  return false;
};

/** True when `git config` args change or remove `core.hooksPath`. */
const configChangesHooksPath = (args: string[]): boolean => {
  const key = args.findIndex(mentionsHooksPath);
  if (key === -1) return false;
  const [action] = args;
  if (action === "set" || action === "unset") return true;
  if (action === "get") return false;
  if (args.some((arg) => arg.startsWith("--get") || arg === "--list")) {
    return false;
  }
  if (args.some((arg) => arg.startsWith("--unset"))) return true;
  return args.slice(key + 1).some((arg) => !arg.startsWith("-"));
};

const checkGit = (args: string[]): string | null => {
  let i = 0;
  while (i < args.length && (args.at(i) ?? "").startsWith("-")) {
    const option = args.at(i) ?? "";
    const value = GIT_GLOBAL_OPTIONS_WITH_VALUE.has(option)
      ? (args.at(++i) ?? "")
      : option;
    if (
      (option === "-c" || option.startsWith("--config-env")) &&
      mentionsHooksPath(value)
    ) {
      return "Overriding core.hooksPath turns off the git hooks.";
    }
    // e.g. `git -c alias.c="commit --no-verify" c`
    if (option === "-c" && value.split(/[\s=]/).some(isNoVerify)) {
      return "`--no-verify` skips the git hooks.";
    }
    i++;
  }
  const subcommand = args.at(i);
  const rest = args.slice(i + 1);

  const end = rest.indexOf("--");
  if ((end === -1 ? rest : rest.slice(0, end)).some(isNoVerify)) {
    return "`--no-verify` skips the git hooks.";
  }
  if (subcommand === "commit" && commitSkipsHooks(rest)) {
    return "`git commit -n` is `--no-verify`, which skips the git hooks.";
  }
  if (subcommand === "config" && configChangesHooksPath(rest)) {
    return "Changing core.hooksPath turns off the git hooks.";
  }
  return null;
};

const checkCommand = ({ assignments, argv }: SimpleCommand): string | null => {
  const disabling = assignments.find(isHookDisablingAssignment);
  if (disabling !== undefined) {
    return `\`${disabling}\` turns off the git hooks.`;
  }

  const [program = "", ...args] = argv;
  if ((program.split("/").pop() ?? program) === "git") return checkGit(args);

  const lefthook = argv.indexOf("lefthook");
  if (lefthook !== -1 && argv[lefthook + 1] === "uninstall") {
    return "`lefthook uninstall` removes the git hooks.";
  }
  return null;
};

/**
 * Returns a message explaining why `command` would skip the repo's checks,
 * or null if it doesn't. Used by the PreToolUse hook on Bash.
 */
export const findBypass = (command: string): string | null => {
  for (const simple of expandCommands(command)) {
    const reason = checkCommand(simple);
    if (reason !== null) return `${reason} ${FIX_IT}`;
  }
  return null;
};
