import type { FlowLane, FlowSeat, FlowTask } from "../../shared/flow-views.ts";
import { ago, lasting } from "./time.ts";

/** Lanes start collapsed and the Lead's line is the only place a seat waiting on a permission shows, so counts must not hide it. */
export function countsInstead(lane: {
  taskCount: number;
  open: boolean;
  lead: { status: string; waiting: string[] } | null;
}): boolean {
  if (lane.taskCount === 0 || lane.open) return false;
  return Boolean(lane.lead) && lane.lead!.status !== "gone" && lane.lead!.waiting.length === 0;
}

/** A seat by its role's label, as the kit names it; the desk may not know yet which role a seat has. */
export const seatName = (seat: FlowSeat | null): string => seat?.label ?? "Seat";

/** `answers` is who answers a seat's permission prompt: the Human, or while they are out of the loop whoever supervises. */
export const seatText = (seat: FlowSeat | null, answers = "you"): string => {
  if (!seat) return "no seat";
  if (seat.waiting.length > 0) return `waiting on ${answers} · ${seat.waiting[0]}`;
  if (seat.status === "gone") return seat.minutes > 0 ? `gone · last heard ${seat.minutes} min ago` : "gone";
  return `${seat.status} · ${lasting(seat.minutes)}`;
};
/** Where a lane works: the Human's own checkout, or a copy of its own. */
export const where = (lane: FlowLane): string => (lane.copy ? `copy ${lane.copy}` : "your checkout");

/** What a task's card says of it: why it cannot start or merge yet, what a waiting one waits for, since when a handed-back one waits, else what its seat is doing. */
export const taskState = (task: FlowTask, answers: string): string => {
  if (task.held) return `${task.status}: ${task.held}`;
  if (task.status === "waiting") return task.after.length > 0 ? `waiting on ${task.after.join(", ")}` : "waiting";
  if (task.handback !== null) return `${task.status} · handed back ${ago(task.handback)}`;
  return `${task.status} · ${seatText(task.peer, answers)}`;
};

/** What a lane's Lead card says of it: the Human's part first, then a hold, a READY, and what is running. */
export const leadState = (lane: FlowLane, answers: string, human: boolean): string => {
  if (lane.landApproval && lane.landApproval.approved) return "landing approved, not landed yet";
  if (lane.landApproval)
    return human ? "landing waits for your approval" : "landing held from while you were in the loop";
  if (lane.onHold) return `on hold ${lasting(lane.onHold.minutes)}: ${lane.onHold.reason}`;
  if (lane.ready !== undefined) return `reported ready ${ago(lane.ready)}`;
  return countsInstead(lane)
    ? `${lane.taskCount} task${lane.taskCount === 1 ? "" : "s"}, ${lane.running} running`
    : seatText(lane.lead, answers);
};
