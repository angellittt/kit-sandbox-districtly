/**
 * Splits a shell command line into separate commands and their words.
 * It's not a full shell parser. It handles enough to find git commands:
 * quotes, `\` escapes, and the things that join commands
 * (`&&`, `||`, `;`, `|`, `&`, new lines, `( )` and backticks).
 *
 * Returns one token list per simple command, e.g.
 * `pnpm lint && git commit -m "a b"` -> [["pnpm", "lint"], ["git", "commit", "-m", "a b"]]
 */
export const splitCommands = (input: string): string[][] => {
  const commands: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let inToken = false;
  let quote: "'" | '"' | null = null;

  const endToken = () => {
    if (inToken) tokens.push(token);
    token = "";
    inToken = false;
  };
  const endCommand = () => {
    endToken();
    if (tokens.length > 0) commands.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input.charAt(i);

    if (quote === "'") {
      if (char === "'") quote = null;
      else token += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && i + 1 < input.length)
        token += input.charAt(++i);
      else token += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      inToken = true;
    } else if (char === "\\" && i + 1 < input.length) {
      const next = input.charAt(++i);
      // A backslash-newline is a line continuation, not part of a token.
      if (next !== "\n") {
        token += next;
        inToken = true;
      }
    } else if (char === " " || char === "\t") {
      endToken();
    } else if ("\n;&|()`".includes(char)) {
      endCommand();
    } else if (char === "$" && input.charAt(i + 1) === "(") {
      endCommand();
    } else if (char === "#" && !inToken) {
      // Comment: skip to the end of the line.
      while (i + 1 < input.length && input.charAt(i + 1) !== "\n") i++;
    } else {
      token += char;
      inToken = true;
    }
  }
  endCommand();
  return commands;
};

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export const isAssignment = (token: string): boolean => ASSIGNMENT.test(token);

/** Commands that run the rest of their arguments as another command. */
const WRAPPERS = new Set([
  "env",
  "sudo",
  "command",
  "exec",
  "time",
  "nohup",
  "xargs",
]);

export interface SimpleCommand {
  /** `NAME=value` pairs that apply to this command (prefix, `env` or `export`). */
  assignments: string[];
  /** The program name and its arguments, after wrappers and assignments. */
  argv: string[];
}

/**
 * Peels leading `NAME=value` assignments and wrappers (`env`, `sudo`, ...) off a
 * token list, so `LEFTHOOK=0 env FOO=1 git push` becomes
 * `{ assignments: ["LEFTHOOK=0", "FOO=1"], argv: ["git", "push"] }`.
 * `export A=1 B=2` is reported as assignments with an empty argv.
 */
export const parseSimpleCommand = (tokens: string[]): SimpleCommand => {
  const assignments: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const word = tokens.at(i) ?? "";
    if (isAssignment(word)) {
      assignments.push(word);
      i++;
    } else if (WRAPPERS.has(word)) {
      i++;
      // Skip the wrapper's own options (`env -i`, `sudo -E`, ...).
      while ((tokens.at(i) ?? "").startsWith("-")) i++;
    } else if (word === "export") {
      assignments.push(...tokens.slice(i + 1).filter(isAssignment));
      return { assignments, argv: [] };
    } else {
      break;
    }
  }
  return { assignments, argv: tokens.slice(i) };
};

const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

/**
 * Like `splitCommands`, but also looks inside `bash -c "..."` and
 * `eval "..."`, so a command can't hide from the checks by being quoted.
 */
export const expandCommands = (input: string, depth = 0): SimpleCommand[] => {
  const result: SimpleCommand[] = [];
  for (const tokens of splitCommands(input)) {
    const command = parseSimpleCommand(tokens);
    result.push(command);
    if (depth >= 3) continue;

    const [program = "", ...args] = command.argv;
    const name = program.split("/").pop() ?? program;
    if (name === "eval") {
      result.push(...expandCommands(args.join(" "), depth + 1));
    } else if (SHELLS.has(name)) {
      const script = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
      const body = script === -1 ? undefined : args[script + 1];
      if (body !== undefined) result.push(...expandCommands(body, depth + 1));
    }
  }
  return result;
};
