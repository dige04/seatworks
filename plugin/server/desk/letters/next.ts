import type { Lane } from "../../domain/lane.ts";

/** For whoever supervises a lane whose Lead is gone: replace_lead seats one, and `then` says what follows. */
export const leadGone = (then: string): string =>
  `Its Lead is gone: replace_lead puts a new Lead on the lane, ${then}.`;

export const SAY_IN_REPORT = "If this changes what you were going to do, say so in your next report.";

export const BOTH_MEET = "what both lanes write meets when the second merges or lands";

/** A lane's Lead as a letter names it: one kept after its lane closed is kept from it, not of it. */
export const leadOf = (lane: Lane): string => `the Lead ${lane.status === "closed" ? "kept from" : "of"} ${lane.id}`;
