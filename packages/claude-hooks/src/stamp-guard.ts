import { basename } from "node:path";
import { STAMP_NAME } from "./push-gate.ts";
import { expandCommands } from "./shell.ts";

const FAKE_PASS =
  "Only `pnpm ci:local` may write the local CI pass stamp. Run it instead of writing the stamp yourself.";

/**
 * Commands that can mention the stamp without writing it (unless their output
 * is redirected to it). Anything else that names it, like `cp`, `tee`,
 * `touch` or `node -e`, is blocked.
 */
const NO_WRITE = new Set([
  "cat",
  "head",
  "tail",
  "ls",
  "stat",
  "wc",
  "test",
  "grep",
  "rg",
  "echo",
  "printf",
  "git",
]);

/** A token like `>`, `>>`, `2>`, `&>` or `>|`: the next token is written to. */
const REDIRECT = /^[0-9&]*>>?\|?$/;

/**
 * Returns a message if `command` could write the pass stamp, else null.
 * Reading it (`cat .git/preloop-pass`) is fine. Used by the PreToolUse hook
 * on Bash, so an agent can't fake a local CI pass.
 */
export const findStampWrite = (command: string): string | null => {
  for (const { assignments, argv } of expandCommands(command)) {
    const tokens = [...assignments, ...argv];
    if (!tokens.some((token) => token.includes(STAMP_NAME))) continue;

    const program = basename(argv.at(0) ?? "");
    const writes = tokens.some(
      (token, i) =>
        token.includes(STAMP_NAME) &&
        (token.includes(">") ||
          REDIRECT.test(tokens.at(i - 1) ?? "") ||
          // `git log --output=<file>` writes to a file.
          (program === "git" && token.startsWith("-"))),
    );
    if (assignments.length > 0 || !NO_WRITE.has(program) || writes) {
      return FAKE_PASS;
    }
  }
  return null;
};

/** Returns a message if an Edit/Write/NotebookEdit targets the pass stamp. */
export const findStampEdit = (
  toolInput: Record<string, unknown> | undefined,
): string | null => {
  const path = toolInput?.file_path ?? toolInput?.notebook_path;
  return typeof path === "string" && basename(path) === STAMP_NAME
    ? FAKE_PASS
    : null;
};
