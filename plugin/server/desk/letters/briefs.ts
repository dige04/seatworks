import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { list } from "./envelope.ts";
import { clip } from "../../core/text.ts";
import type { SetUp } from "../copies/setup.ts";

function besideLine(task: Task, beside: Task[]): string {
  if (beside.length === 0) return "";
  const where = task.mode === "parallel" ? "in copies of their own or the lane's" : "in copies of their own";
  const who = beside
    .map((other) => `${other.id} (${other.title})${other.holds.length > 0 ? ` holds ${other.holds.join(", ")}` : ""}`)
    .join("; ");
  return `Beside you, ${where}, each merged into the lane branch once accepted: ${who}. What they write reaches your copy only as your hand-back brings the lane in: leave it to them, and ask if you need it first.`;
}

function whereLines(task: Task, lane: Lane): string[] {
  const start = task.hints.length > 0 ? ["Where to start reading (a start, not a fence):", list(task.hints), ""] : [];
  if (task.mode === "parallel")
    return [...start, "You hold (others write beside you, so ask before writing outside it):", list(task.holds)];
  const writes =
    lane.writeSet.length > 0
      ? `; the lane's write set is ${lane.writeSet.join(", ")}, and a change outside it is noted for your Lead`
      : "";
  return [...start, `Where the change goes, callers and tests included, is yours to find${writes}.`];
}

/** How the project's setup went in the copy a seat starts in, as the first thing it knows of that copy. */
export function setUpLine(setUp: SetUp | undefined): string {
  if (!setUp) return "";
  const ran = `Setup: ${setUp.command} ran in this copy before you started`;
  return setUp.ok
    ? `${ran}, and passed in ${setUp.seconds}s.`
    : `${ran} and ${setUp.failed}; its log is ${setUp.logFile}, which ends:\n${clip(setUp.tail, 1200)}`;
}

/** What must hold, what was chosen, and what nobody knows yet, each under its own head so none reads as another. */
export function briefListLines(entry: Pick<Task, "constraints" | "choices" | "unknowns">, chosen: string): string[] {
  const parts: [string, string[] | undefined][] = [
    ["Must hold:", entry.constraints],
    [chosen, entry.choices],
    ["Not known yet, and how to find out:", entry.unknowns],
  ];
  return parts.flatMap(([head, items]) => (items && items.length > 0 ? ["", head, list(items)] : []));
}

export function taskBrief(task: Task, lane: Lane, beside: Task[], setUp?: SetUp): string {
  return [
    `TASK ${task.id}: ${task.title}`,
    "",
    `Goal: ${task.goal}`,
    "",
    "Acceptance:",
    list(task.acceptance),
    ...briefListLines(task, "Chosen so far, each yours to question with evidence that it does not fit the goal:"),
    "",
    task.settled
      ? "This task builds to what is settled: raise a choice only when the code shows it cannot hold."
      : "This task is open: a premise or choice above may be reopened with evidence, and what you find may change the plan.",
    "",
    ...whereLines(task, lane),
    "",
    "Out of scope:",
    list(task.outOfScope),
    "",
    `Context: ${task.context?.trim() || "none"}`,
    ...(setUp ? ["", setUpLine(setUp)] : []),
    task.skills && task.skills.length > 0 ? `\nSkills to open: ${task.skills.join(", ")}` : "",
    "",
    besideLine(task, beside),
    "",
    task.mode === "parallel"
      ? `You are on branch ${task.branch} in your own working copy, branched from ${lane.branch}. Commit your work on this branch, then call done.`
      : `You work on branch ${task.branch} in the lane's working copy, branched from ${lane.branch}. Commit your work there, then call done.${task.startSha ? ` Your task started from ${task.startSha}: that is BASE for anything that asks what existed before you began.` : ""}`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

/** One thing the desk kept of a task, as it was written: a hand-back, a Lead's rework, or a review's verdict. */
export type Kept = { at: number; what: "hand-back" | "rework" | "review"; text: string };

const KEPT_AS = { "hand-back": "Its hand-back", rework: "What your Lead sent back", review: "A review of it" };

/** The brief of a task a fresh Peer takes over, then why, and what came before it as the desk kept it. */
export function reseatBrief(task: Task, lane: Lane, beside: Task[], why: string, record: Kept[]): string {
  return [
    taskBrief(task, lane, beside),
    "",
    `You take over ${task.id} from the Peer that worked it before you: ${why}`,
    `Its branch and copy hold what that Peer committed and left: read git log, git status and the diff from ${task.startSha ?? lane.branch} before you change anything, and carry on from there rather than over it. What it wrote below is its account, to check against the code, not to trust.`,
    ...(record.length > 0 ? ["", "What came before, oldest first:"] : []),
    ...record.map((kept) => `${KEPT_AS[kept.what]}:\n<record>\n${clip(kept.text, 2500)}\n</record>`),
  ].join("\n");
}

/**
 * `place` says where the change can be read and how; the desk works it out, since where it is depends on what has
 * happened to the task's copy and branch since.
 */
export function reviewBrief(
  review: Task,
  target: Task | undefined,
  focus: string,
  place: { where: string; range?: string; lane?: string },
): string {
  const lines = target
    ? [
        `REVIEW ${review.id} of ${target.id}: ${target.title}`,
        "",
        `${place.where}; see it with ${place.range ?? ""}.`,
        "",
        `Goal of the change: ${target.goal}`,
        "",
        "Acceptance it must meet:",
        list(target.acceptance),
      ]
    : review.scope === "lane"
      ? [
          `REVIEW ${review.id} of lane ${review.lane}: ${place.lane ?? review.title}`,
          "",
          `${place.where}${place.range ? `; see its change with ${place.range}` : ""}.`,
          "",
          "Acceptance it must meet:",
          list(review.acceptance),
        ]
      : [`REVIEW ${review.id}: ${review.title}`, "", `${place.where}. Read whatever the question needs.`];
  lines.push("", "Open question:", focus);
  if (review.rechecks)
    lines.push(
      "",
      `${review.rechecks.review}, an earlier review of this work, found these; say in earlier, in this order, whether each is resolved, still open, or wrong:`,
      ...review.rechecks.findings.map((line, index) => `${index + 1}. ${line}`),
    );
  if (review.asked)
    lines.push(
      "",
      "The project asks every review of a change like this, answered in order in answers:",
      ...review.asked.map((question, index) => `${index + 1}. ${question}`),
    );
  lines.push(
    "",
    "Your copy is yours to run checks in, and goes with this review: don't edit the change or commit. When finished, call done with your verdict and findings.",
  );
  return lines.join("\n");
}
