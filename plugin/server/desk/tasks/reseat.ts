import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { roleNamed } from "../../catalog/kit/roles.ts";
import { errorText } from "../../core/errors.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, besideOf } from "../../domain/ledger.ts";
import { TASK, type Task, type TaskStatus } from "../../domain/task.ts";
import { workKey } from "../claims.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { laneTask } from "../lane-task.ts";
import { holdRefusal } from "../lanes/hold.ts";
import { type Kept, reseatBrief } from "../letters/briefs.ts";
import type { Project } from "../project/project.ts";
import { letGo } from "../seats/gone.ts";
import { seatTitle } from "../seats/names.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { loadLedger } from "../store/ledger.ts";

/** A task whose next move is its Peer's or its Lead's, with the branch and copy its work is in. */
const RESEATABLE: readonly TaskStatus[] = ["running", "rework", "done", "failed", "stalled"];

const SHOWN = 3;

/**
 * A fresh Peer on a task, as a Lead asks: the one it had goes first, since a task has one at a time, and the new one
 * works on the same branch and copy, briefed from what the desk kept of the task, never from what the watch saw.
 */
export async function reseatTask(
  desk: DeskServices,
  caller: Caller,
  args: { task: string; why: string },
): Promise<ToolReply> {
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const found = laneTask(ledger, caller, str(args.task));
  if (typeof found === "string") return no(found);
  const { lane, task } = found;
  if (task.kind === "review") return no(`${task.id} is a review: cut it and start_review again for a fresh reviewer.`);
  const held = holdRefusal(lane);
  if (held) return no(held);
  if (!RESEATABLE.includes(task.status))
    return no(
      `${task.id} is ${task.status}: only a task at work, handed back, stalled or whose merge failed takes a fresh Peer.`,
    );
  const copy = copyOf(ledger, lane, task);
  const role = ledger.agents[task.peer ?? ""]?.role ?? task.opening?.role;
  if (!copy || !task.branch || !role) return no(`${task.id} has no branch and copy on record to seat a Peer on.`);
  const key = workKey(project, task.id);
  if (!desk.seating.take(key)) return no(`${task.id} is being seated already.`);
  try {
    await letGo(desk, desk.roster, project, task.peer, true);
    const brief = reseatBrief(task, lane, besideOf(ledger, task), str(args.why), recordOf(project, ledger, task));
    const peer = await desk.agents.start(project, copy, role, {
      parent: caller.id,
      title: seatTitle.of(task, roleNamed(desk.kit, role)!),
      prompt: brief,
      labels: { "seatworks.lane": lane.id, "seatworks.task": task.id },
    });
    desk.ledgers.transact(project, (current) => {
      const entry = current.tasks[task.id];
      if (!entry) return;
      if (!TASK.move(entry, "resume")) TASK.move(entry, "rework");
      Object.assign(entry, { peer, silent: 0, updatedAt: Date.now() });
      delete entry.peerGone;
      current.agents[peer] = { id: peer, role, lane: lane.id, task: task.id };
    });
    recordEvent(project, { kind: "seat.released", seat: task.peer ?? "", of: task.id });
    recordEvent(project, { kind: "task.started", task: task.id, peer, mode: task.mode, slot: task.slot ?? "in place" });
    return ok(
      `${task.id} has a fresh Peer, ${peer}, on ${task.branch} in the same copy, briefed with its brief, hand-backs, reworks and reviews; the one it had is let go. Its hand-back arrives as mail.`,
    );
  } catch (error) {
    return no(
      `The fresh Peer could not start, and the one it had is let go: ${errorText(error)}. Cut the task, or reseat it again.`,
    );
  } finally {
    desk.seating.release(key);
  }
}

function copyOf(ledger: Ledger, lane: Lane, task: Task): { path: string; workspaceId?: string } | undefined {
  if (!task.worktree) return undefined;
  const slot = task.slot ? ledger.slots[task.slot] : lane.slot ? ledger.slots[lane.slot] : undefined;
  return { path: task.worktree, workspaceId: slot?.workspaceId ?? lane.workspaceId };
}

/** What the desk kept of the task, as it was written, the latest few of each: hand-backs, reworks, reviews' verdicts. */
function recordOf(project: Project, ledger: Ledger, task: Task): Kept[] {
  const dir = join(project.state, "handbacks");
  const handbacks = existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith(`${task.id}-`)) : [];
  const reviews = Object.values(ledger.tasks).filter(
    (other) => other.kind === "review" && other.of === task.id && other.handback,
  );
  const latest = (kept: Kept[]) => kept.sort((a, b) => a.at - b.at).slice(-SHOWN);
  return [
    ...latest(handbacks.map((name) => ({ at: stamp(name), what: "hand-back", text: read(join(dir, name)) }))),
    ...latest((task.sentBack ?? []).map((sent) => ({ ...sent, what: "rework" }))),
    ...latest(
      reviews.map((review) => ({ at: review.handback!.at, what: "review", text: read(review.handback!.file) })),
    ),
  ].sort((a, b) => a.at - b.at);
}

const stamp = (name: string) => Number(/-(\d+)\.md$/.exec(name)?.[1] ?? 0);

function read(file: string): string {
  try {
    return readFileSync(file, "utf-8").trim();
  } catch {
    return `(${file} could not be read)`;
  }
}
