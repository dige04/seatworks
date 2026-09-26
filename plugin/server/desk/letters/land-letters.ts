import type { Lane } from "../../domain/lane.ts";
import { type Letter, ended, fyi, mail } from "./envelope.ts";

/** What a lane's landing and closing send: it may go ahead, it waits on the Human, what they decided, it closed. */
export const landLetters = {
  canLand(lane: Lane): Letter {
    return mail(
      "canland",
      [lane.id, Date.now()],
      `CAN LAND ${lane.id} (${lane.title}): the turn that was in the way has ended.`,
      "land_lane it again.",
    );
  },

  /** The way back out of a DETOUR: the lane that waited is told, since it cannot see the other one; dropped, the way is not cleared. */
  detourClosed(detour: Lane, waiting: Lane, landing: string, landed: boolean): Letter {
    if (!landed) {
      const text = `DETOUR DROPPED ${detour.id} (${detour.title}), the detour your lane ${waiting.id} was waiting on: it closed without landing, and its branch ${detour.branch} is kept.`;
      return mail(
        "detour",
        [detour.id, Date.now()],
        text,
        "Go on without it; ask if your lane still needs what it was for.",
      );
    }
    const text = [
      `CLEARED ${detour.id} (${detour.title}), the detour your lane ${waiting.id} was waiting on: ${landing}.`,
      "",
      `Your lane branch ${waiting.branch} does not have it yet.`,
    ].join("\n");
    return mail(
      "detour",
      [detour.id, Date.now()],
      text,
      "Read what it did before you go on; ask if your work needs it on your branch.",
    );
  },

  /** `head` is the lane's tip it was held at: a hold is told once per commit, and asks nothing of a Lead that has stopped. */
  landHeld(lane: Lane, reason: string, head: string): Letter {
    const text = `LAND HELD ${lane.id} (${lane.title}): the Human looks at it before it lands. ${reason} Approved, it lands and the lane closes; sent back, LAND SENT BACK brings their note. A new commit means it is looked at again from the start.`;
    return fyi(
      mail(
        "landheld",
        [lane.id, head],
        text,
        "Nothing now; a merge into the lane before they decide restarts their look.",
      ),
    );
  },

  /** Another lane landed on this one's base, which now conflicts with it: word ahead of the landing that would find it. */
  baseMoved(landed: Lane, lane: Lane, conflicts: string[]): Letter {
    const text = `BASE MOVED ${lane.id} (${lane.title}): ${landed.id} (${landed.title}) landed on ${lane.base}, which now conflicts with ${lane.branch} in ${conflicts.join(", ")}. Nothing was merged.`;
    return fyi(
      mail(
        "basemoved",
        [lane.id, landed.id],
        text,
        `Nothing now: who takes ${lane.base} in before the lane lands is chosen by whoever supervises; ask if your lane's work needs it sooner.`,
      ),
    );
  },

  /** The base does not merge into the lane cleanly: a fact for its Lead, since who takes it in is chosen above the lane. */
  baseConflict(lane: Lane, conflicts: string[]): Letter {
    const text = `BASE CONFLICT ${lane.id} (${lane.title}): ${lane.base} moved on, and merging it into ${lane.branch} stops on conflicts in ${conflicts.join(", ")}. Nothing was left in your working copy, and the lane does not land until it takes ${lane.base} in.`;
    return fyi(
      mail(
        "baseconflict",
        [lane.id, conflicts.join(",")],
        text,
        `Nothing now: who takes ${lane.base} in is chosen by whoever supervises, who tells you if it is this lane.`,
      ),
    );
  },

  /** Its lane closed under a Lead kept on, which asks nothing of it now: read with whatever wakes it next. */
  closed(lane: Lane, landed: boolean, how: string): Letter {
    const text = `LANE CLOSED ${lane.id} (${lane.title}): ${landed ? "landed" : "dropped"}; ${how}. Its Peers are let go, and you stay on with what you know of it until the owner releases you.`;
    return fyi(
      mail("closed", [lane.id], text, "Nothing of the lane is yours to do now: answer whoever writes to you about it."),
    );
  },

  landSentBack(lane: Lane, note: string, head: string): Letter {
    return mail(
      "landback",
      [lane.id, head],
      `LAND SENT BACK ${lane.id} (${lane.title}): ${ended(note || "the Human gave no reason; ask what to change")} The lane stays open.`,
      "Act on the note, then report the lane ready again.",
    );
  },

  landDecided(lane: Lane, how: "landed" | "blocked" | "again" | "changed" | "sent back", text: string): Letter {
    const told = (said: string, next: string) => mail("land", [lane.id, how, Date.now()], said, next);
    if (how === "landed")
      return fyi(told(`LANDED ${lane.id} (${lane.title}) after the Human approved it: ${text}`, "Nothing now."));
    if (how === "sent back")
      return fyi(
        told(
          `SENT BACK ${lane.id} (${lane.title}) by the Human: ${ended(text || "no reason was given")} The lane stays open, and its Lead has the note.`,
          "Nothing now.",
        ),
      );
    if (how === "again")
      return told(
        `HELD AGAIN ${lane.id} (${lane.title}): the Human approved it, but landing it turned up more. ${text}`,
        "Tell the Human it waits for them again, and why.",
      );
    if (how === "changed")
      return told(
        `CHANGED ${lane.id} (${lane.title}) after its landing was held, so the Human's approval did not count.`,
        "land_lane it to have it checked as it is now.",
      );
    return told(
      `APPROVED ${lane.id} (${lane.title}) for landing by the Human, but it could not land yet: ${text}. The approval stands while the lane does not change.`,
      "Clear what it names; land_lane then lands it without asking the Human again.",
    );
  },
};
