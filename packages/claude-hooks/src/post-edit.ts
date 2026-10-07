import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { OK, type HookInput, type HookResult } from "./hook-io.ts";
import { findNewSuppressions } from "./suppressions.ts";

export type Runner = (
  command: string,
  args: string[],
  cwd: string,
) => { status: number | null; output: string };

export interface Deps {
  run: Runner;
  exists: (path: string) => boolean;
}

const defaultDeps: Deps = {
  run: (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return {
      status: result.status,
      output: result.error ? String(result.error) : output,
    };
  },
  exists: existsSync,
};

const LINTABLE = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/** Keeps a huge lint report from flooding Claude's context. */
const MAX_OUTPUT = 4000;
const clip = (text: string): string =>
  text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n...(truncated)`
    : text;

interface EditedFile {
  filePath: string;
  before: string;
  after: string;
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** What the tool call changed: the file, and the text it replaced and added. */
const readEdit = ({
  tool_name,
  tool_input = {},
}: HookInput): EditedFile | null => {
  const filePath = str(tool_input.file_path);
  if (!filePath) return null;
  switch (tool_name) {
    case "Write":
      return { filePath, before: "", after: str(tool_input.content) };
    case "Edit":
      return {
        filePath,
        before: str(tool_input.old_string),
        after: str(tool_input.new_string),
      };
    case "MultiEdit": {
      const edits: { old_string?: unknown; new_string?: unknown }[] =
        Array.isArray(tool_input.edits) ? tool_input.edits : [];
      return {
        filePath,
        before: edits.map((e) => str(e.old_string)).join("\n"),
        after: edits.map((e) => str(e.new_string)).join("\n"),
      };
    }
    default:
      return null;
  }
};

const suppressionWarning = (labels: string[]): string =>
  `This edit added ${labels.map((label) => `\`${label}\``).join(", ")}. ` +
  "These switch a check off. Justify or remove it: fix the underlying " +
  "problem if you can, otherwise leave a comment explaining why it's needed " +
  "and tell the developer.";

/**
 * Runs Prettier, then oxlint, then ESLint on the file Claude just edited.
 * Uses the repo's own tools and config, same as pre-commit.
 * On errors it returns exit code 2, so Claude sees them.
 */
export const runPostEdit = (
  input: HookInput,
  deps = defaultDeps,
): HookResult => {
  const edit = readEdit(input);
  if (edit === null) return OK;

  const filePath = resolve(input.cwd ?? process.cwd(), edit.filePath);
  // The file's own checkout, so edits in a git worktree use that worktree's config.
  const git = deps.run(
    "git",
    ["rev-parse", "--show-toplevel"],
    dirname(filePath),
  );
  if (git.status !== 0) return OK;
  const root = git.output.trim();
  if (!deps.exists(filePath)) return OK;

  const file = relative(root, filePath);
  const warnings = findNewSuppressions(edit.before, edit.after);
  const warning = warnings.length > 0 ? suppressionWarning(warnings) : "";
  const errors: string[] = [];

  const bin = (name: string) => join(root, "node_modules", ".bin", name);
  const prettier = bin("prettier");
  const oxlint = bin("oxlint");
  const eslint = bin("eslint");

  if (![prettier, oxlint, eslint].every(deps.exists)) {
    errors.push(
      "Prettier/oxlint/ESLint aren't installed. Run `pnpm install` first.",
    );
  } else {
    const format = deps.run(
      prettier,
      ["--write", "--ignore-unknown", "--log-level=warn", filePath],
      root,
    );
    if (format.status !== 0) errors.push(`Prettier failed:\n${format.output}`);

    if (LINTABLE.has(extname(filePath))) {
      // Most rules run in oxlint; the ESLint configs turn those rules off.
      // oxlint picks up the .oxlintrc.json nearest the file.
      const ox = deps.run(oxlint, ["--max-warnings=0", filePath], root);
      if (ox.status !== 0) errors.push(`oxlint failed:\n${ox.output}`);

      const lint = deps.run(
        eslint,
        ["--max-warnings=0", "--no-warn-ignored", filePath],
        root,
      );
      if (lint.status !== 0) errors.push(`ESLint failed:\n${lint.output}`);
    }
  }

  if (errors.length > 0) {
    const message = [
      `Checks failed for ${file}. Fix these now:`,
      ...errors,
      warning,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { exitCode: 2, stdout: "", stderr: clip(message) };
  }
  if (warning) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `${file}: ${warning}`,
        },
      }),
      stderr: "",
    };
  }
  return OK;
};
