import type { RoleSpec } from "../../catalog/kit/kit.ts";
import { namedOrNot, roleThatCan } from "../../catalog/kit/roles.ts";
import { errorText } from "../../core/errors.ts";
import { headSha } from "../../core/git.ts";
import { changedFiles } from "../../core/git-diff.ts";
import { clip } from "../../core/text.ts";
import { reviewBrief } from "../letters/briefs.ts";
import { workKey } from "../claims.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { holdRefusal } from "../lanes/hold.ts";
import { changeOf } from "../lanes/land-facts.ts";
import type { Lane } from "../../domain/lane.ts";
import { findTask, laneOfLead, nextTaskId } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { seatTitle } from "../seats/names.ts";
import { type Project, riskRulesOf, rulesFor } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

/** A start_review call as the tool takes it: one task, or the whole lane when `task` is left out. */
type ReviewCall = { task?: string; focus: string; title?: string; role?: string };

/** What a review reads: the commit its copy holds, how its brief names that, and the range that is the change. */
type Reading = { at: string; where: string; spec?: string };

type Planned = {
  lane: Lane;
  target?: Task;
  role: RoleSpec;
  asked: string[];
  reading: Reading;
};

export async function startReview(desk: DeskServices, caller: Caller, args: ReviewCall): Promise<ToolReply> {
  const planned = await plan(desk, caller, args);
  if (typeof planned === "string") return no(planned);
  const focus = str(args.focus);
  const review = record(desk, caller.project, planned, str(args.title), focus);
  if (typeof review === "string") return no(review);
  return seat(desk, caller, planned, review, focus);
}

async function plan(desk: DeskServices, caller: Caller, args: ReviewCall): Promise<Planned | string> {
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const lane = laneOfLead(ledger, caller.id);
  if (!lane?.worktree) return "You have no open lane.";
  const held = holdRefusal(lane);
  if (held) return held;
  const named = str(args.task);
  const target = named ? findTask(ledger, named) : undefined;
  if (named && (!target || target.lane !== lane.id || target.kind !== "code"))
    return `${named} is not a code task in your lane.`;
  const reading = target ? await taskReading(project, target, lane) : await laneReading(project, lane);
  if (typeof reading === "string") return reading;
  // No fallback to a plain worker: a stand-in could rewrite what it is asked to judge.
  const lens = str(args.role);
  const role = roleThatCan(desk.kit, "review", lens || undefined);
  if (!role) return namedOrNot(desk.kit, "review", lens, "review, so there is nobody to ask a read-only question of");
  const asked = await askedOf(desk, project, lane, reading);
  return { lane, target, role, asked, reading };
}

/**
 * A review is a task of the lane that holds nothing, recorded running and claimed for seating like any other. The lane
 * is read again here, where it is written: it may have closed or been put on hold while the review was planned.
 */
function record(
  { ledgers, seating }: Pick<DeskServices, "ledgers" | "seating">,
  project: Project,
  planned: Planned,
  title: string,
  focus: string,
): Task | string {
  const { lane, target, asked, reading } = planned;
  return ledgers.transact(project, (current): Task | string => {
    const now = current.lanes[lane.id];
    if (now?.status !== "open") return `Lane ${lane.id} closed while its review was being set up.`;
    const held = holdRefusal(now);
    if (held) return held;
    const id = nextTaskId(now, "review");
    const at = Date.now();
    const created: Task = {
      id,
      lane: lane.id,
      kind: "review",
      mode: "lane",
      of: target?.id,
      asked: asked.length > 0 ? asked : undefined,
      title: title || (target ? `Review ${target.id}` : clip(focus.split(/\r?\n/)[0] ?? "Review", 50)),
      goal: focus,
      acceptance: target?.acceptance ?? [],
      hints: [],
      holds: [],
      outOfScope: [],
      context: lane.branch,
      startSha: reading.at,
      status: "running",
      openedAt: at,
      updatedAt: at,
      silent: 0,
    };
    current.tasks[id] = created;
    seating.take(workKey(project, id));
    return { ...created };
  });
}

/**
 * The reviewer works in a copy of its own at the commit it reviews, which it may write in (caches, build output) and
 * which goes with the review: the copies where the work is done stay out of its reach, so what it ran is its own.
 */
async function seat(
  desk: DeskServices,
  caller: Caller,
  planned: Planned,
  review: Task,
  focus: string,
): Promise<ToolReply> {
  const { ledgers, agents, seating, slots } = desk;
  const { project } = caller;
  const { lane, target, role, reading } = planned;
  let copy: string | undefined;
  try {
    const work = `${review.id} review of ${target?.id ?? lane.id}`;
    const slot = await slots.acquire(project, { commit: reading.at }, { task: review.id, throwaway: true }, work);
    copy = slot.id;
    ledgers.setTask(project, review.id, (entry) => Object.assign(entry, { worktree: slot.path, slot: slot.id }));
    const reviewer = await agents.start(project, slot, role.role, {
      parent: caller.id,
      title: seatTitle.review(review.id, target?.id ?? lane.id),
      prompt: reviewBrief(review, target, focus, {
        where: reading.where,
        range: reading.spec && `git diff ${reading.spec}`,
      }),
      labels: { "seatworks.lane": lane.id, "seatworks.task": review.id },
    });
    ledgers.transact(project, (current) => {
      const entry = current.tasks[review.id];
      if (entry) Object.assign(entry, { peer: reviewer, updatedAt: Date.now() });
      current.agents[reviewer] = { id: reviewer, role: role.role, lane: lane.id, task: review.id };
    });
    recordEvent(project, { kind: "review.started", task: review.id, of: target?.id ?? null, reviewer });
    return ok(
      `Started ${review.id}${target ? ` on ${target.id}` : ""} with reviewer ${reviewer}. The verdict arrives as mail.`,
    );
  } catch (error) {
    ledgers.moveTask(project, review.id, "cut");
    await slots.release(project, copy);
    return no(`The reviewer could not start: ${errorText(error)}`);
  } finally {
    seating.release(workKey(project, review.id));
  }
}

/**
 * The commit a task's review reads: as far as its Peer has committed while it works, its last hand-back after, and the
 * merge once it has one. Its change is read from where its branch meets the lane's: what the lane brought is not its.
 */
async function taskReading(project: Project, target: Task, lane: Lane): Promise<Reading | string> {
  if (target.mergeSha)
    return {
      at: target.mergeSha,
      where: `Your working copy holds ${lane.branch} at the merge ${target.mergeSha.slice(0, 7)}, which brought ${target.id} in`,
      spec: `${target.mergeSha}^1..${target.mergeSha}`,
    };
  const tip = target.branch ? await headSha(project.root, target.branch) : undefined;
  const handed = target.status === "running" || target.status === "rework" ? undefined : target.handback?.commit;
  const at = handed ?? tip;
  if (!at)
    return `${target.id} worked in a copy that has been given back, and neither a merge nor a branch is left to read it from. Ask for a review of the lane instead.`;
  return {
    at,
    where: `Your working copy holds ${target.branch} at ${at.slice(0, 7)}`,
    spec: `${lane.branch}...${at}`,
  };
}

/** A review of the whole lane reads its branch as it is now. */
async function laneReading(project: Project, lane: Lane): Promise<Reading | string> {
  const at = await headSha(project.root, lane.branch);
  if (!at) return `git could not read ${lane.branch}, so there is nothing to review yet.`;
  return { at, where: `Your working copy holds ${lane.branch} at ${at.slice(0, 7)}.` };
}

/** The questions of every risk rule the reviewed change reaches; a change git cannot read is asked them all. */
async function askedOf(
  { kit }: Pick<DeskServices, "kit">,
  project: Project,
  lane: Lane,
  reading: Reading,
): Promise<string[]> {
  const rules = riskRulesOf(project, kit);
  const files = reading.spec ? await changedFiles(project.root, reading.spec) : (await changeOf(project, lane)).files;
  return [...new Set((files ? rulesFor(rules, files) : rules).map((rule) => rule.reviewQuestion))];
}
