// PreToolUse hook on Edit/MultiEdit/Write/NotebookEdit: blocks edits to the
// local CI pass stamp, so an agent can't fake a `pnpm ci:local` pass.
// Wired up in .claude/settings.json.
import { OK, exitWith, readHookInput } from "../hook-io.ts";
import { findStampEdit } from "../stamp-guard.ts";

const reason = findStampEdit(readHookInput()?.tool_input);

exitWith(reason === null ? OK : { exitCode: 2, stdout: "", stderr: reason });
