// PostToolUse hook on Edit/MultiEdit/Write: formats and lints the edited
// file, and warns about new eslint-disable / it.skip / @ts-ignore markers.
// Wired up in .claude/settings.json.
import { exitWith, OK, readHookInput } from "../hook-io.ts";
import { runPostEdit } from "../post-edit.ts";

const input = readHookInput();
exitWith(input === null ? OK : runPostEdit(input));
