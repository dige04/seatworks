import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeConfigAtomic } from "../../core/config-file.ts";
import { executableIn, nodeBin, pathDirs, stateRoot } from "../../core/paths.ts";
import type { Kit } from "../kit/kit.ts";

const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
/** `text` as a batch file's `echo` prints it: cmd's own characters escaped, and `%` doubled. */
const echoed = (text: string) => text.replace(/[\^&|<>()]/g, "^$&").replaceAll("%", "%%");

/** The git a seat's PATH finds past the shim: the shim's directory is skipped, since what is there is named git too. */
function realGit(skip: string): string | undefined {
  return executableIn(
    pathDirs().filter((dir) => dir && dir !== skip),
    "git",
  );
}

/**
 * Writes the directory a seat's PATH starts at: a git that runs the kit's shim over the real git, and for each command the kit
 * refuses one that says why and fails. Nothing where this machine has no git.
 */
export function seatBin(kit: Kit, root = stateRoot()): string | undefined {
  const dir = join(root, "bin");
  const git = realGit(dir);
  if (!git) return undefined;
  const [node, shim] = [nodeBin(), join(kit.dir, "bin", "git-shim.mjs")];
  const commands: Record<string, { sh: string; cmd: string }> = {
    git: {
      sh: `#!/bin/sh\nexec ${quoted(node)} ${quoted(shim)} ${quoted(git)} "$@"\n`,
      cmd: `@echo off\r\n"${node}" "${shim}" "${git}" %*\r\n`,
    },
  };
  for (const [name, why] of Object.entries(kit.refused)) {
    const said = `${name}: refused: ${why}. Say what you need to whoever gave you the work.`;
    commands[name] = {
      sh: `#!/bin/sh\necho ${quoted(said)} >&2\nexit 1\n`,
      cmd: `@echo off\r\n>&2 echo ${echoed(said)}\r\nexit /b 1\r\n`,
    };
  }
  // Windows shells find the batch file; the Git Bash some agents run commands in finds the script.
  const wanted = Object.fromEntries(
    Object.entries(commands).flatMap(([name, { sh, cmd }]) =>
      process.platform === "win32"
        ? [
            [name, sh],
            [`${name}.cmd`, cmd],
          ]
        : [[name, sh]],
    ),
  );
  mkdirSync(dir, { recursive: true });
  // The directory is the plugin's alone: a command the kit no longer refuses must run again.
  for (const name of readdirSync(dir)) if (!(name in wanted)) rmSync(join(dir, name), { force: true });
  for (const [name, text] of Object.entries(wanted)) {
    const file = join(dir, name);
    if (!existsSync(file) || readFileSync(file, "utf-8") !== text) writeConfigAtomic(file, text, 0o755);
  }
  return dir;
}
