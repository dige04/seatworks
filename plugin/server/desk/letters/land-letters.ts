import { join } from "node:path";
import type { Lane } from "../../domain/lane.ts";
import { type Letter, ended, fyi, mail } from "./envelope.ts";

/** What a lane's landing and closing send: it may go ahead, it waits on the Human, what they decided, it closed. */
export const landLetters = {
  /** Uncommitted, the block is a tracked change in the Human's own copy, which no lane working there lands past. */
  blockChanged(root: string): Letter {
    return fyi(
      mail(
        "blockchanged",
        [root, Date.now()],
        `BLOCK CHANGED in ${join(root, "AGENTS.md")}: the desk wrote the kit's new Seatworks block there, and it is not committed. Every seat reads the block from its own instructions already; uncommitted, it stops a lane working in that copy from landing.`,
        "Have it committed: the Human commits it, or a lane's task does.",
      ),
    );
  },

  /** A landing the desk carried out for whoever asked once the turns in its way ended: what land_lane would have answered. */
  carried(lane: Lane, landed: boolean, text: string): Letter {
    return mail(
      "land",
      [lane.id, "carried", Date.now()],
      `${landed ? "LANDED" : "NOT LANDED"} ${lane.id} (${lane.title}): ${text}`,
      landed
        ? `Know it when you next speak of ${lane.id}; nothing of it waits on you.`
        : "Act on what it names; land_lane then lands it as it is.",
    );
  },

  /**
   * An ordered landing called off, as the lane is no longer what whoever asked for it judged: found when the turn in its
   * way `ended`, or at once by what changed it.
   */
  calledOff(lane: Lane, changed: string, ended: boolean): Letter {
    const said = ended
      ? `the turn in its way ended, but ${changed} since your land_lane, so the desk did not land it`
      : `${changed} since your land_lane, so the desk will not land it`;
    return mail(
      "land",
      [lane.id, "calledoff", Date.now()],
      `NOT LANDED ${lane.id} (${lane.title}): ${said}.`,
      "land_lane it again to land it as it is now, or drop_lane it.",
    );
  },

  /** An ordered landing that broke when the desk carried it out, rather than landing or being refused. */
  failed(lane: Lane, error: string): Letter {
    return mail(
      "land",
      [lane.id, "failed", Date.now()],
      `NOT LANDED ${lane.id} (${lane.title}): the turn in its way ended, but the desk's landing of it failed: ${ended(error)}`,
      "Read status for where the lane stands, then land_lane it again or drop_lane it.",
    );
  },

  /** Its Lead went on reviewing a lane it had reported ready: the READY is gone, and comes again with a new report. */
  readyWithdrawn(lane: Lane, review: string): Letter {
    return fyi(
      mail(
        "withdrawn",
        [lane.id, review],
        `READY WITHDRAWN ${lane.id} (${lane.title}): its Lead started ${review} after reporting it ready, so its READY no longer stands.`,
        "Nothing now: a new ready report comes as mail.",
      ),
    );
  },

  /** The way out of a DETOUR: the waiting lane is told, as it cannot see the other; dropped, the way is not cleared. */
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

  /** `head` is the tip it was held at: a hold is told once per commit, and asks nothing of a Lead that has stopped. */
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

  /** Another lane landed on the base the audit lane reads: new there, so the audit looks at it before it goes out. */
  landedForAudit(landed: Lane, how: string): Letter {
    return mail(
      "audit",
      [landed.id],
      `LANDED ${landed.id} (${landed.title}) on ${landed.base}: ${how}. Your lane audits what goes out from ${landed.base}, and this is new there.`,
      `Take what it brought to ${landed.base} into your audit.`,
    );
  },

  /** Another lane landed on this one's base, which now conflicts with it: word ahead of the landing that finds it. */
  baseMoved(landed: Lane, lane: Lane, conflicts: string[]): Letter {
    const text = `BASE MOVED ${lane.id} (${lane.title}): ${landed.id} (${landed.title}) landed on ${lane.base}, which now conflicts with ${lane.branch} in ${conflicts.join(", ")}. Nothing was merged.`;
    return fyi(
      mail(
        "basemoved",
        [lane.id, landed.id],
        text,
        `Nothing now: who takes ${lane.base} in before the lane lands is chosen by the Supervisor; ask if your lane's work needs it sooner.`,
      ),
    );
  },

  /** The base does not merge into the lane: a fact for its Lead, since who takes it in is chosen above the lane. */
  baseConflict(lane: Lane, conflicts: string[]): Letter {
    const text = `BASE CONFLICT ${lane.id} (${lane.title}): ${lane.base} moved on, and merging it into ${lane.branch} stops on conflicts in ${conflicts.join(", ")}. Nothing was left in your working copy, and the lane does not land until it takes ${lane.base} in. A Peer that takes it in runs git merge --no-edit ${lane.base} and commits what it settles with git commit --no-edit, since an editor would wait forever in its session.`;
    return fyi(
      mail(
        "baseconflict",
        [lane.id, conflicts.join(",")],
        text,
        `Nothing now: who takes ${lane.base} in is chosen by the Supervisor, who tells you if it is this lane.`,
      ),
    );
  },

  /** Its lane closed under a Lead kept on, which asks nothing of it now: read with whatever wakes it next. */
  closed(lane: Lane, landed: boolean, how: string): Letter {
    const text = `LANE CLOSED ${lane.id} (${lane.title}): ${landed ? "landed" : "dropped"}; ${how}. Its Peers are let go, and you stay on with what you know of it until the Supervisor or the Human releases you.`;
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

  /** Each wakes whoever supervises: what the Human decided changes where the lane stands, which it would otherwise tell them wrong. */
  landDecided(
    lane: Lane,
    how: "landed" | "ordered" | "blocked" | "again" | "changed" | "sent back",
    text: string,
  ): Letter {
    const told = (said: string, next: string) => mail("land", [lane.id, how, Date.now()], said, next);
    if (how === "landed")
      return told(
        `LANDED ${lane.id} (${lane.title}) after the Human approved it: ${text}`,
        `Know it when you next speak of ${lane.id}; nothing of it waits on you.`,
      );
    if (how === "ordered")
      return told(
        `APPROVED ${lane.id} (${lane.title}) by the Human: ${text}`,
        `Know it when you next speak of ${lane.id}; LANDED or NOT LANDED comes as mail.`,
      );
    if (how === "sent back")
      return told(
        `SENT BACK ${lane.id} (${lane.title}) by the Human: ${ended(text || "no reason was given")} The lane stays open, and its Lead has the note.`,
        `Know it when you next speak of ${lane.id}; its Lead acts on the note.`,
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
