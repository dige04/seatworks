import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorText } from "../../core/errors.ts";
import { git } from "../../core/git.ts";

const files = (stdout: string) => stdout.split("\0").filter(Boolean);

/**
 * Copies into a new copy the files git ignores that the project's `.worktreeinclude` names, as Claude Code, Codex and
 * Conductor read that file: a copy made from git never has them. Says why when it could not.
 */
export async function bringIncluded(root: string, copy: string): Promise<string | undefined> {
  const named = join(root, ".worktreeinclude");
  if (!existsSync(named)) return undefined;
  const untracked = (exclude: string) => git(root, ["ls-files", "-z", "--others", "--ignored", exclude]);
  const [ignored, included] = await Promise.all([
    untracked("--exclude-standard"),
    untracked(`--exclude-from=${named}`),
  ]);
  if (ignored.code !== 0 || included.code !== 0) return "git could not list the files .worktreeinclude names";
  const wanted = new Set(files(included.stdout));
  try {
    for (const file of files(ignored.stdout).filter((path) => wanted.has(path))) {
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      copyFileSync(join(root, file), join(copy, file));
    }
  } catch (error) {
    return `a file .worktreeinclude names could not be copied: ${errorText(error)}`;
  }
  return undefined;
}
