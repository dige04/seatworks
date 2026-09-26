import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Run = { code: number; stdout: string; stderr: string };

export function git(cwd: string, args: string[], timeout = 60_000): Promise<Run> {
  return new Promise((resolve) => {
    // core.quotePath=false: non-ASCII paths otherwise come back octal-escaped and match no path a write set names.
    execFile(
      "git",
      ["-C", cwd, "-c", "core.quotePath=false", ...args],
      { timeout, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error
          ? typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 1
          : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  const run = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return run.code === 0 ? run.stdout.trim() : undefined;
}

export async function headSha(cwd: string, ref = "HEAD"): Promise<string | undefined> {
  const run = await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return run.code === 0 ? run.stdout.trim() : undefined;
}

/** Three states because a failed `status` (dir gone, not a repo, timeout, no git) must not read as dirty. */
type Cleanliness = "clean" | "dirty" | "unknown";

async function cleanliness(cwd: string, args: string[]): Promise<Cleanliness> {
  const run = await git(cwd, args);
  if (run.code !== 0) return "unknown";
  return run.stdout.trim() === "" ? "clean" : "dirty";
}

/** Tracked files only; untracked files do not count. */
export function cleanState(cwd: string): Promise<Cleanliness> {
  return cleanliness(cwd, ["status", "--porcelain", "--untracked-files=no"]);
}

/**
 * Uncommitted and untracked paths, or undefined when git cannot say. Read NUL-separated, so a path with a space or an
 * arrow in it is itself, and a rename names where it went, not where it came from.
 */
export async function uncommittedPaths(cwd: string): Promise<string[] | undefined> {
  const run = await git(cwd, ["status", "--porcelain", "-z"]);
  if (run.code !== 0) return undefined;
  const entries = run.stdout.split("\0").filter(Boolean);
  const found: string[] = [];
  for (let at = 0; at < entries.length; at++) {
    const entry = entries[at]!;
    found.push(entry.slice(3));
    // A rename or copy is followed by the path it came from, which is no change of its own.
    if (/^[RC]|^.[RC]/.test(entry)) at++;
  }
  return found;
}

/** Nothing uncommitted or untracked, as a lane takeover requires. */
export async function pristineState(cwd: string): Promise<Cleanliness> {
  const paths = await uncommittedPaths(cwd);
  return paths === undefined ? "unknown" : paths.length > 0 ? "dirty" : "clean";
}

/** The files git tracks in `cwd`, or undefined when git cannot say: an empty list would read as an empty copy. */
export async function trackedFiles(cwd: string): Promise<string[] | undefined> {
  const run = await git(cwd, ["ls-files", "-z"]);
  return run.code === 0 ? run.stdout.split("\0").filter(Boolean) : undefined;
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return (await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
}

/** Deletes `branch` once all of it is in `into`; false, and it is kept, when it holds more or git could not tell. */
export async function dropMerged(cwd: string, branch: string, into: string): Promise<boolean> {
  return (await contains(cwd, into, branch)) === true && (await git(cwd, ["branch", "-D", branch])).code === 0;
}

/**
 * Puts `cwd` on `branch`, made from `start` when it is not there yet; git's reason when it cannot. `discard` drops
 * edits to tracked files, and `untracked` untracked files too, which only a copy the desk made may lose.
 */
export async function switchTo(
  cwd: string,
  branch: string,
  start: string,
  discard = false,
  untracked = false,
): Promise<string | undefined> {
  const exists = await branchExists(cwd, branch);
  const run = await git(cwd, [
    "switch",
    ...(discard ? ["--discard-changes"] : []),
    ...(exists ? [branch] : ["-c", branch, start]),
  ]);
  if (run.code === 0 && discard && untracked) await git(cwd, ["clean", "-fd"]);
  return run.code === 0 ? undefined : run.stderr.trim() || `git switch exited ${run.code}`;
}

/** Undefined when git could not answer: zero read as "no commits beyond the lane branch", which is a claim. */
export async function commitsAhead(cwd: string, base: string, branch: string): Promise<number | undefined> {
  const run = await git(cwd, ["rev-list", "--count", `${base}..${branch}`]);
  if (run.code !== 0) return undefined;
  const count = Number(run.stdout.trim());
  return Number.isInteger(count) ? count : undefined;
}

/** Whether all of `branch` is in `into`; undefined when git could not say, since a branch is deleted on this answer. */
export async function contains(cwd: string, into: string, branch: string): Promise<boolean | undefined> {
  if (!(await branchExists(cwd, branch))) return undefined;
  const ahead = await commitsAhead(cwd, into, branch);
  return ahead === undefined ? undefined : ahead === 0;
}

/** `timeout` is the project's to set: checking out a large repository takes what it takes. */
export async function addWorktree(
  root: string,
  path: string,
  branch: string,
  base: string,
  timeout: number,
): Promise<{ ok: boolean; message: string }> {
  if (!(await branchExists(root, base))) return { ok: false, message: `the base branch ${base} does not exist` };
  if (await branchExists(root, branch)) return { ok: false, message: `the branch ${branch} already exists` };
  const run = await git(root, ["worktree", "add", "-b", branch, path, base], timeout);
  // git can fail with no output at all (timeout, missing binary); never report an empty reason.
  return {
    ok: run.code === 0,
    message: (run.stderr || run.stdout).trim() || `git worktree add exited ${run.code} with nothing to say`,
  };
}

export async function removeWorktree(root: string, path: string | undefined): Promise<void> {
  if (!path) return;
  await git(root, ["worktree", "remove", "--force", path], 60_000);
  await git(root, ["worktree", "prune"], 30_000);
}

/** What the desk commits is made as seatworks and unsigned: the Human's name and signer are for their own commits. */
export const AS_DESK = [
  "-c",
  "user.name=seatworks",
  "-c",
  "user.email=seatworks@localhost",
  "-c",
  "commit.gpgSign=false",
];

type MergeResult = { ok: true; before: string; after: string } | { ok: false; conflicts: string[]; message: string };

/**
 * `leave` keeps a merge stopped on conflicts in place for the seat whose branch it is to settle and commit; anything
 * else that stops it is undone. The Human's rerere would settle conflicts unseen, their signer can wait on them, and
 * their commit hooks judge their people's commits, not the desk's merges: none of them applies.
 */
export async function mergeBranch(
  cwd: string,
  branch: string,
  message: string,
  { leave = false, timeout = 120_000 }: { leave?: boolean; timeout?: number } = {},
): Promise<MergeResult> {
  const before = await headSha(cwd);
  if (!before) return { ok: false, conflicts: [], message: "the lane working copy has no HEAD" };
  const own = [...AS_DESK, "-c", "rerere.enabled=false"];
  const run = await git(cwd, [...own, "merge", "--no-ff", "--no-verify", "-m", message, branch], timeout);
  if (run.code === 0) return { ok: true, before, after: (await headSha(cwd)) ?? before };
  const unmerged = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = unmerged.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!leave || conflicts.length === 0) await git(cwd, ["merge", "--abort"]);
  return { ok: false, conflicts, message: (run.stdout + run.stderr).trim().slice(-1500) };
}

/**
 * The files merging `onto` into `branch` would stop on, read without touching any working copy: none when it merges
 * clean, nothing when git cannot say.
 */
export async function conflictsWith(cwd: string, branch: string, onto: string): Promise<string[] | undefined> {
  const run = await git(cwd, ["merge-tree", "--write-tree", "--name-only", "--no-messages", branch, onto]);
  if (run.code === 0) return [];
  if (run.code !== 1) return undefined;
  // The tree comes first, then each conflicted file up to a blank line.
  const lines = run.stdout.split("\n").slice(1);
  const end = lines.findIndex((line) => !line.trim());
  return [...new Set((end < 0 ? lines : lines.slice(0, end)).map((line) => line.trim()))];
}

export async function mergeUnderWay(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code === 0;
}

/** `into` as the merge that brought `branch` in, if it is one: a merge a stop cut off after git made it. */
export async function mergeOf(
  cwd: string,
  into: string,
  branch: string,
): Promise<{ before: string; after: string } | undefined> {
  const sha = async (ref: string) => {
    const run = await git(cwd, ["rev-parse", "--verify", "-q", ref]);
    return run.code === 0 ? run.stdout.trim() : undefined;
  };
  const [after, before, merged, tip] = await Promise.all([into, `${into}^1`, `${into}^2`, branch].map(sha));
  return after && before && merged && merged === tip ? { before, after } : undefined;
}

/** What is uncommitted in `cwd`, named: a stray message file reads as unfinished work otherwise. */
export async function uncommittedIn(cwd: string): Promise<string> {
  const run = await git(cwd, ["status", "--porcelain"]);
  const lines = run.stdout.split("\n").filter((line) => line.trim());
  const shown = lines
    .slice(0, 6)
    .map((line) => line.trim())
    .join(", ");
  return lines.length > 6
    ? `${shown} and ${lines.length - 6} more`
    : shown || "something git reports but does not name";
}

/** Where `branch` left `base`: what a lane changed is read from here, however far `base` has moved since. */
export async function mergeBase(cwd: string, base: string, branch: string): Promise<string | undefined> {
  const run = await git(cwd, ["merge-base", base, branch]);
  return run.code === 0 ? run.stdout.trim() || undefined : undefined;
}

export async function isAncestor(root: string, base: string, branch: string): Promise<boolean> {
  return (await git(root, ["merge-base", "--is-ancestor", base, branch])).code === 0;
}

/** Where a landed lane's own commits stay reachable once its branch is gone: squashed, base never carries them. */
export const landedRef = (lane: string) => `refs/seatworks/lanes/${lane}`;

export function gitCommonDir(cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function excludeFromGit(repo: string, pattern: string): void {
  const common = gitCommonDir(repo);
  if (!common) return;
  try {
    const file = join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf-8") : "";
    if (current.split(/\r?\n/).includes(pattern)) return;
    mkdirSync(join(common, "info"), { recursive: true });
    appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${pattern}\n`);
  } catch {
    // Left out of the exclude list, the path shows as untracked: noise, never lost work.
  }
}
