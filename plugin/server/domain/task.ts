import type { Amendment } from "./amendment.ts";
import { Lifecycle, type Moves } from "./lifecycle.ts";

export type TaskStatus =
  "waiting" | "running" | "done" | "rework" | "queued" | "merging" | "merged" | "failed" | "cut" | "stalled";

const IN_HAND: TaskStatus[] = ["running", "rework", "done", "failed", "stalled"];

const MOVES = {
  start: { from: ["waiting"], to: "running" },
  wait: { from: ["running"], to: "waiting" },
  handBack: { from: IN_HAND, to: "done" },
  rework: { from: [...IN_HAND, "merged"], to: "rework" },
  queue: { from: IN_HAND, to: "queued" },
  merge: { from: ["queued"], to: "merging" },
  requeue: { from: ["merging"], to: "queued" },
  merged: { from: ["merging"], to: "merged" },
  // Stopped on conflicts or red with its lane brought in: the lane branch is unchanged, and the task its Lead's again.
  stop: { from: ["merging"], to: "done" },
  fail: { from: ["queued", "merging"], to: "failed" },
  stall: { from: ["running", "rework"], to: "stalled" },
  lose: { from: ["running", "rework"], to: "stalled" },
  resume: { from: ["stalled"], to: "running" },
  cut: { from: ["waiting", ...IN_HAND, "queued"], to: "cut" },
} satisfies Moves<TaskStatus>;

export type TaskMove = keyof typeof MOVES;

export const TASK = new Lifecycle<TaskStatus, TaskMove>(MOVES);

export const DECIDED: readonly TaskStatus[] = ["queued", "merging", "merged", "cut"];
export const SETTLED: readonly TaskStatus[] = ["merged", "cut"];
export const IN_QUEUE: readonly TaskStatus[] = ["queued", "merging"];
export const AT_WORK: readonly TaskStatus[] = ["running", "rework"];
// A task in the lane's copy has it on its own branch from its start until it is merged or cut, a failed merge included.
export const HOLDS_COPY: readonly TaskStatus[] = [
  "running",
  "rework",
  "done",
  "failed",
  "stalled",
  "queued",
  "merging",
];
export const ACTIVE: readonly TaskStatus[] = ["running", "rework", "queued", "merging"];

/** Work a task still stands for: a code task not merged or cut, or a review still reading; one that handed back is done. */
export function openWork(task: Task): boolean {
  return !SETTLED.includes(task.status) && !(task.kind === "review" && task.status === "done");
}

/** How a review marks a finding an earlier review of the same work made. */
export type Mark = "resolved" | "open" | "wrong";

/**
 * `reworks` is how many times the task had been sent back when this came: a later rework makes it an older word. A
 * review's also keeps its findings, and its marks on the earlier review's it was given.
 */
type Handback = {
  file: string;
  outcome: string;
  commit?: string;
  summary: string;
  at: number;
  reworks: number;
  gate?: { ok: boolean; note: string; sha?: string; over?: string };
  findings?: string[];
  marks?: Mark[];
};

export type Task = {
  id: string;
  lane: string;
  kind: "code" | "review";
  /** A review of the whole lane, against its acceptance, as its Lead asked for before READY; not a scout's or a council's. */
  scope?: "lane";
  mode: "lane" | "parallel";
  of?: string;
  asked?: string[];
  title: string;
  goal: string;
  acceptance: string[];
  hints: string[];
  holds: string[];
  outOfScope: string[];
  context?: string;
  skills?: string[];
  peer?: string;
  branch?: string;
  worktree?: string;
  slot?: string;
  startSha?: string;
  mergeSha?: string;
  mergedAt?: number;
  status: TaskStatus;
  openedAt: number;
  updatedAt: number;
  handback?: Handback;
  after?: string[];
  opening?: { role: string };
  startHeld?: { why: string; tried?: boolean };
  mergeHeld?: { why: string };
  amended?: Amendment[];
  reworks?: number;
  sentBack?: { at: number; text: string }[];
  rechecks?: { review: string; findings: string[] };
  acceptedAt?: number;
  silent: number;
  peerGone?: boolean;
};
