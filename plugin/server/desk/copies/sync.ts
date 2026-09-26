import {
  branchExists,
  currentBranch,
  dropMerged,
  git,
  headSha,
  isAncestor,
  mergeBranch,
  pristineState,
  switchTo,
} from "../../core/git.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";

/**
 * The lane's copy back on the lane branch from a task's own, `discard`ing work left there; git's reason when it cannot.
 * A lane working in the Human's own checkout keeps the files git does not track, which are theirs.
 */
export async function backOnLane(lane: Lane, discard = false): Promise<string | undefined> {
  return lane.worktree ? switchTo(lane.worktree, lane.branch, lane.branch, discard, Boolean(lane.slot)) : undefined;
}

/**
 * Takes the lane's copy off a gone task's branch back onto the lane branch, keeping that branch only while it holds
 * commits nothing else has. Work left there goes with the task, save on the Human's own branch: theirs is kept.
 */
export async function leaveCopy(lane: Lane, task: Task): Promise<{ refused?: string; kept?: string } | undefined> {
  if (!lane.worktree || !task.branch || (await currentBranch(lane.worktree)) !== task.branch) return undefined;
  const refused = await backOnLane(lane, !lane.onBranch);
  if (refused) return { refused };
  return {
    kept:
      !(await dropMerged(lane.worktree, task.branch, lane.branch)) && (await branchExists(lane.worktree, task.branch))
        ? task.branch
        : undefined,
  };
}

export type Synced = { at: string } | { conflicts: string[]; by: string[] } | { not: string };

/** The subject of the commit that merges a task into its lane, which is how a conflict later names who wrote a side. */
export const mergeSubject = (task: Pick<Task, "id" | "title">) => `Merge ${task.id}: ${task.title}`;

const mergedTask = (subject: string) => /^Merge (L\d+-[TR]\d+):/.exec(subject)?.[1];

/** Tasks whose merges into the lane changed `files` since this branch left it: who wrote a conflict's other side. */
async function changedBy(cwd: string, tip: string, files: string[]): Promise<string[]> {
  // Limited to paths, git hides a merge whose tree is the side it brought in: each merge's own files name it instead.
  const run = await git(cwd, [
    "log",
    "-z",
    "--first-parent",
    "--merges",
    "--diff-merges=first-parent",
    "--name-only",
    "--format=%x01%s",
    `HEAD..${tip}`,
  ]);
  const ids = run.stdout.split("\x01").flatMap((record) => {
    const [subject = "", ...changed] = record
      .split("\0")
      .map((part) => part.trim())
      .filter(Boolean);
    const id = mergedTask(subject);
    return id && changed.some((file) => files.includes(file)) ? [id] : [];
  });
  return [...new Set(ids)];
}

/**
 * Brings the lane branch into a task's own copy, so what it hands back or merges is what the lane would become. A copy
 * with work uncommitted is left as it is; conflicts are left in it for its Peer to settle and commit.
 */
export async function bringLaneIn(
  task: Task & { worktree: string; branch: string },
  lane: Lane,
  timeout: number,
): Promise<Synced> {
  const cwd = task.worktree;
  const tip = await headSha(cwd, lane.branch);
  if (!tip) return { not: `git could not read ${lane.branch}` };
  if (await isAncestor(cwd, tip, "HEAD")) return { at: tip };
  const copy = await pristineState(cwd);
  if (copy !== "clean")
    return { not: copy === "dirty" ? "its copy has work uncommitted" : "git could not read its copy" };
  const merged = await mergeBranch(cwd, tip, `Bring ${lane.branch} into ${task.branch}`, { leave: true, timeout });
  if (merged.ok) return { at: tip };
  if (merged.conflicts.length === 0) return { not: merged.message.split("\n")[0] || "git merge failed" };
  // HEAD is still the task's own tip while the merge waits on its conflicts.
  return { conflicts: merged.conflicts, by: await changedBy(cwd, tip, merged.conflicts) };
}
