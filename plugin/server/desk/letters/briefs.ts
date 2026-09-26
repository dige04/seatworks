import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { list } from "./envelope.ts";

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

export function taskBrief(task: Task, lane: Lane, beside: Task[]): string {
  return [
    `TASK ${task.id}: ${task.title}`,
    "",
    `Goal: ${task.goal}`,
    "",
    "Acceptance:",
    list(task.acceptance),
    "",
    ...whereLines(task, lane),
    "",
    "Out of scope:",
    list(task.outOfScope),
    "",
    `Context: ${task.context?.trim() || "none"}`,
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

/**
 * `place` says where the change can be read and how; the desk works it out, since where it is depends on what has
 * happened to the task's copy and branch since.
 */
export function reviewBrief(
  review: Task,
  target: Task | undefined,
  focus: string,
  place: { where: string; range?: string },
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
    : [`REVIEW ${review.id}: ${review.title}`, "", `${place.where} Read whatever the question needs.`];
  lines.push("", "Open question:", focus);
  if (review.asked)
    lines.push(
      "",
      "The project asks every review of a change like this, answered in order in answers:",
      ...review.asked.map((question, index) => `${index + 1}. ${question}`),
    );
  lines.push("", "Read only: don't edit files or commit. When finished, call done with your verdict and findings.");
  return lines.join("\n");
}
