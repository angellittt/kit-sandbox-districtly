import { readFileSync } from "node:fs";

/** The fields of Claude Code's hook input that these hooks use. */
export interface HookInput {
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface HookResult {
  /** 0 lets the tool call go ahead, 2 blocks it (or, after the fact, reports back). */
  exitCode: 0 | 2;
  /** JSON for Claude Code, e.g. additionalContext. */
  stdout: string;
  /** Shown to Claude when exitCode is 2. */
  stderr: string;
}

export const OK: HookResult = { exitCode: 0, stdout: "", stderr: "" };

/**
 * Reads the hook input from stdin. Returns null if it isn't JSON, so the
 * hook lets the tool call go ahead.
 */
export const readHookInput = (): HookInput | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(0, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

export const exitWith = ({ exitCode, stdout, stderr }: HookResult): never => {
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exit(exitCode);
};
