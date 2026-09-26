import { firstOverlap, serialHits } from "../../core/scope.ts";
import { IN_QUEUE } from "../../domain/task.ts";
import { type Args, str, strs } from "../context.ts";
import { holderOf } from "../copies/holder.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, activeTasks } from "../../domain/ledger.ts";
import type { Refusal } from "../refusal.ts";
import { taskWaitsFor } from "../waiting/rules.ts";

/** Where a task may start in its lane, or why not: decided in the transaction that starts it. */
export function taskPlacement(
  ledger: Ledger,
  lane: Lane,
  holds: string[],
  parallel: boolean,
  serial: string[],
): Refusal | undefined {
  if (parallel) return parallelProblem(ledger, lane, holds, serial);
  const holder = holderOf(ledger, lane);
  if (!holder) return undefined;
  const beside = "or run this beside it in parallel, holding paths independent of it.";
  if (holder.status === "done" || holder.status === "failed") {
    const waits = holder.status === "done" ? "has handed back" : "failed to merge";
    return {
      why: `${holder.id} ${waits} and is waiting on you, and it still holds the lane's working copy — rework would wake its Peer in there.`,
      next: `Accept or cut it first, ${beside}`,
    };
  }
  const doing = IN_QUEUE.includes(holder.status)
    ? "is in the merge queue, and holds the lane's working copy until it merges."
    : "is still writing in the lane's working copy, and it holds one writer at a time.";
  return { why: `${holder.id} ${doing}`, next: `Pass after ${holder.id} to start this once it is merged, ${beside}` };
}

/** What a parallel task holding `holds` collides with: its one-writer paths, and each task at work beside it. */
function collisions(
  ledger: Ledger,
  lane: Lane,
  holds: string[],
  serial: string[],
  apart: ReadonlySet<string>,
): { serial: string[]; tasks: { id: string; at: string }[] } {
  const tasks = activeTasks(ledger, lane.id).flatMap((task) => {
    const at = task.kind === "code" && !apart.has(task.id) ? firstOverlap(holds, task.holds) : undefined;
    return at ? [{ id: task.id, at }] : [];
  });
  return { serial: serialHits(holds, serial), tasks };
}

export function parallelProblem(
  ledger: Ledger,
  lane: Lane,
  holds: string[],
  serial: string[],
  self?: string,
): Refusal | undefined {
  const found = collisions(ledger, lane, holds, serial, new Set(self ? [self] : []));
  if (found.serial.length > 0)
    return {
      why: `A parallel task can't hold ${found.serial.join(", ")}.`,
      next: "Run it in the lane's working copy instead.",
    };
  const task = found.tasks[0];
  if (task)
    return {
      why: `What it holds overlaps what ${task.id} holds at ${task.at}.`,
      next: `Pass after ${task.id} instead of running it in parallel.`,
    };
  return undefined;
}

/** One task of a layout: `hinted` is what it was given to hold in the lane's copy, kept among its hints instead. */
export type Planned = {
  key: string;
  args: Args;
  parallel: boolean;
  holds: string[];
  hints: string[];
  hinted: string[];
  after: string[];
};

/**
 * The tasks in an order they can run in, or why they cannot: each key once, paths held by exactly the tasks that run
 * beside others, each `after` a key of it or a task of this lane still to be merged, and no loop.
 */
export function readPlan(ledger: Ledger, lane: Lane, listed: Args[]): Planned[] | string {
  const tasks: Planned[] = listed.map((args) => {
    const parallel = args.parallel === true;
    const named = strs(args.holds);
    return {
      key: str(args.key).trim().toUpperCase(),
      args,
      parallel,
      holds: parallel ? named : [],
      hints: parallel ? strs(args.hints) : [...new Set([...strs(args.hints), ...named])],
      hinted: parallel ? [] : named,
      after: [...new Set(strs(args.after).map((id) => id.trim().toUpperCase()))],
    };
  });
  const keys = new Set<string>();
  for (const task of tasks) {
    if (!task.key) return "Every task has a key, which the others name in after.";
    if (keys.has(task.key)) return `The key ${task.key} names two tasks; give each its own.`;
    if (ledger.tasks[task.key])
      return `The key ${task.key} is already a task of this project; pick keys that are not task ids.`;
    keys.add(task.key);
    if (task.parallel && task.holds.length === 0)
      return `${task.key} runs beside others but holds nothing: name the paths it writes meanwhile, as coarse as the work allows.`;
  }
  for (const task of tasks) {
    const outside = task.after.filter((id) => !keys.has(id));
    const found = outside.length > 0 ? taskWaitsFor(ledger, lane.id, outside) : [];
    if (typeof found === "string") return `${task.key}: ${found} Take it out of after.`;
  }
  const order: Planned[] = [];
  const placed = new Set<string>();
  while (order.length < tasks.length) {
    // Listed order wherever after leaves a choice.
    const next = tasks.find(
      (task) => !placed.has(task.key) && task.after.every((id) => !keys.has(id) || placed.has(id)),
    );
    if (!next)
      return `The tasks loop: ${tasks
        .filter((task) => !placed.has(task.key))
        .map((task) => task.key)
        .join(", ")} wait for each other, so none of them could ever start.`;
    order.push(next);
    placed.add(next.key);
  }
  return order;
}

/** What in the layout would collide as it runs: two tasks holding one path, or one held beside another writer. */
export function layoutProblems(ledger: Ledger, lane: Lane, plan: Planned[], serial: string[]): string[] {
  const findings: string[] = [];
  const before = new Map<string, Set<string>>();
  for (const task of plan) before.set(task.key, new Set(task.after.flatMap((id) => [id, ...(before.get(id) ?? [])])));
  const ordered = (a: Planned, b: Planned) => before.get(a.key)!.has(b.key) || before.get(b.key)!.has(a.key);
  for (const [index, task] of plan.entries()) {
    for (const other of plan.slice(index + 1)) {
      if (!(task.parallel || other.parallel) || ordered(task, other)) continue;
      const clash = firstOverlap(task.holds, other.holds);
      if (clash)
        findings.push(
          `${task.key} and ${other.key} may run at once and both hold ${clash}: order them with after, or split the paths.`,
        );
    }
    if (!task.parallel) continue;
    const found = collisions(ledger, lane, task.holds, serial, before.get(task.key)!);
    if (found.serial.length > 0)
      findings.push(
        `${task.key} runs beside others but holds ${found.serial.join(", ")}, which only one writer at a time may write: run it in the lane's copy.`,
      );
    for (const active of found.tasks)
      findings.push(
        `${task.key} holds ${active.at}, which ${active.id} holds and is still writing, and does not wait for it: add ${active.id} to its after, or leave those paths to ${active.id}.`,
      );
  }
  return findings;
}

/** A task's held paths outside its lane's write set, as a note to its Lead: a write set never refuses a task. */
export function outsideNote(lane: Lane, id: string, holds: string[]): string | undefined {
  const outside = lane.writeSet.length > 0 ? holds.filter((path) => !firstOverlap([path], lane.writeSet)) : [];
  if (outside.length === 0) return undefined;
  return `${id} holds ${outside.join(", ")}, outside the lane's write set ${lane.writeSet.join(", ")}; it runs as asked, and what it changes there is noted again at hand-back and landing.`;
}

/** Paths a task in the lane's copy was given to hold, as a note to its Lead: that copy's one writer takes hints. */
export function hintedNote(id: string, paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  const as = paths.length === 1 ? "a hint" : "hints";
  return `${id} runs in the lane's copy, which has one writer at a time, so it holds nothing: it keeps ${paths.join(", ")} as ${as} of where to start.`;
}
