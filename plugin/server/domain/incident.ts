import { Lifecycle } from "./lifecycle.ts";

export type Held = "nobody";

/** How much a fact asks of whoever watches: a page now, attention soon, or only a note on the record. */
export type Level = "page" | "attend" | "note";

/** What a watch saw that the desk books as an incident; `theirs` when its quote is only the seat's own words or command. */
export type Finding = { kind: string; level: Exclude<Level, "note">; quote: string; facts: string[]; theirs?: true };

export type Incident = {
  id: string;
  seat: string;
  provider?: string;
  where: string;
  lane?: string;
  task?: string;
  kind: string;
  level: "page" | "attend";
  quote: string;
  theirs?: true;
  later?: string;
  facts: string[];
  opened: number;
  last: number;
  count: number;
  open: boolean;
  told?: number;
  held?: Held;
  label?: "useful" | "noise" | "unknown";
  note?: string;
  closed?: number;
};

/**
 * Every fact the code raises and its level; one that can open an incident has the title a person reads it by, and `theirs`
 * when its quote is the seat's own text with no word of the watch's in it.
 */
const FACTS = {
  destructive: { level: "page", title: "Ran a command that cannot be undone", theirs: true },
  stuck: { level: "attend", title: "Going round in circles" },
  "no-recovery": { level: "attend", title: "Did not recover from a failure" },
  "test-weakened": { level: "attend", title: "A test lost its assertions" },
  suppressed: { level: "attend", title: "Silenced a check instead of fixing it" },
  unverified: { level: "attend", title: "Handed back without running the gate" },
  "claim-contradicted": { level: "attend", title: "Handed back as complete while its last check failed" },
  "long-turn": { level: "attend", title: "A turn running far longer than usual" },
  "rework-loop": { level: "attend", title: "Sent back again and again" },
  "patched-not-fixed": { level: "attend", title: "Several tasks patched, none fixed" },
  "accepted-unfinished": { level: "attend", title: "Work taken in unfinished" },
  "reviews-unconverged": { level: "attend", title: "Reviews piling up with nothing accepted" },
  "certainty-only": { level: "attend", title: "A review told to report only certainties" },
  "brief-prewritten": { level: "attend", title: "A brief that writes the answer out" },
  struggling: { level: "attend", title: "A task struggling" },
  architecture: { level: "attend", title: "A task's reach widened: structure settling" },
  turning: { level: "attend", title: "A task's goal turned sharply" },
  "lane-idle": { level: "attend", title: "A Lead idle with nothing going" },
  "ask-waiting": { level: "attend", title: "An ask left waiting on its reader" },
  "call-failed": { level: "note" },
  "gate-failed": { level: "note" },
  "outside-scope": { level: "note" },
  "edit-before-look": { level: "note" },
} as const satisfies Record<
  string,
  { level: "note" } | { level: Exclude<Level, "note">; title: string; theirs?: true }
>;

export type FactKind = keyof typeof FACTS;

export type Fact = { kind: FactKind; level: Level; quote: string; theirs?: true };

export const fact = (kind: FactKind, quote: string): Fact => ({
  kind,
  level: FACTS[kind].level,
  quote,
  ...("theirs" in FACTS[kind] ? { theirs: true as const } : {}),
});

/** The title of a kind the incident book holds, which may be one this code no longer raises. */
export function factTitle(kind: string): string | undefined {
  return (FACTS as Record<string, { title?: string }>)[kind]?.title;
}

type Delivery = "unsent" | "held" | "told";

type Delivered = { told?: number; held?: Held };

const DELIVERY = new Lifecycle<Delivery, "tell" | "unheard">({
  tell: { from: ["unsent", "held"], to: "told" },
  unheard: { from: ["told"], to: "held" },
});

/** Where an incident stands on being told, read from what it keeps: when it was told, and why it was not. */
export const deliveryOf = (incident: Delivered): Delivery =>
  incident.told !== undefined ? "told" : incident.held ? "held" : "unsent";

export function tell(incident: Delivered, at: number): boolean {
  if (!DELIVERY.may(deliveryOf(incident), "tell")) return false;
  delete incident.held;
  incident.told = at;
  return true;
}

/** A letter that found nobody to read it: the incident waits for somebody to be seated instead. */
export function unheard(incident: Delivered): boolean {
  if (!DELIVERY.may(deliveryOf(incident), "unheard")) return false;
  delete incident.told;
  incident.held = "nobody";
  return true;
}

/** Closing is apart from being told: a closed incident keeps whether it was told, and why not. */
export function close(incident: { open: boolean; closed?: number }, at: number): boolean {
  if (!incident.open) return false;
  incident.open = false;
  incident.closed = at;
  return true;
}
