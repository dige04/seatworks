import { clip, hash, outside } from "../../core/text.ts";
import type { Lane } from "../../domain/lane.ts";
import { IN_QUEUE, type Task } from "../../domain/task.ts";
import { type Letter, mail } from "./envelope.ts";
import { SAY_IN_REPORT, leadOf } from "./next.ts";

/** One sending of a message: keyed by the event, not the words, since an instruction sent again is a second one. */
export type Sending = { by: string; to: string; at: number };

const sendingIds = (sending: Sending, text: string) => [sending.by, hash(sending.to, text), sending.at];

export const messageLetters = {
  /** `reader` answers only through its own tools: words it says in its turn reach nobody. */
  message(from: string, text: string, sending: Sending, reader: "worker" | "lead"): Letter {
    const next =
      reader === "worker"
        ? "Weigh it against your task: act on what holds, say with evidence where it does not, and answer in your hand-back, or with ask if a reply cannot wait."
        : "Weigh it against your lane: act on what holds, say with evidence where it does not, and answer with report, or with ask if you need a decision back first.";
    return mail("message", sendingIds(sending, text), [`MESSAGE from ${from}`, "", text].join("\n"), next);
  },

  /** The Supervisor may reach a Peer directly, never out of the Lead's sight: this sets the Lead's picture right. */
  reconciled(lane: Lane, task: Task, peer: string, text: string, sending: Sending): Letter {
    const letter = [
      `RECONCILE ${lane.id}: the owner reached your Peer on ${task.id} directly.`,
      "",
      "What reached them:",
      clip(text, 1500),
      "",
      `Current intent: ${lane.outcome}`,
      `Ownership: ${task.id} (${task.title}) is still owned by ${peer}, on ${lane.branch}. The lane is still yours.`,
      "Topology: unchanged. No seat was started, moved or put away.",
      task.status === "merged"
        ? `Integration and acceptance: ${task.id} is merged already, and nothing here changed that.`
        : IN_QUEUE.includes(task.status)
          ? `Integration and acceptance: you have already accepted ${task.id} and it is waiting to merge; nothing here changed that.`
          : `Integration and acceptance: unchanged. Accepting ${task.id} is still yours to judge, and nothing here accepted it.`,
    ].join("\n");
    return mail("reconcile", ["message", ...sendingIds(sending, text)], letter, SAY_IN_REPORT);
  },

  humanWrote(lane: Lane, task: Task | undefined, seat: string, text: string): Letter {
    const closed = lane.status === "closed";
    const who = task ? `the Peer on ${task.id} (${task.title})` : `${leadOf(lane)} (${lane.title})`;
    const lines = [
      `HUMAN WROTE to ${who} directly, past you:`,
      "<human>",
      outside("human", text, 1500),
      "</human>",
      ...(task ? ["", "Its Lead was not told."] : []),
    ];
    const next = closed
      ? `Lane ${lane.id} is closed: if it asks for more work, open a lane for it; if it settles the concept, write it into CONTEXT.md.`
      : task
        ? "If it changes what the task or the lane is asked, carry it in: tell the Lead, amend_lane, or settle it with the Human."
        : "If it changes what the lane is asked, carry it in with amend_lane; if it settles the concept, write it into CONTEXT.md.";
    return mail("humanwrote", [seat, hash(text)], lines.join("\n"), next);
  },
};
