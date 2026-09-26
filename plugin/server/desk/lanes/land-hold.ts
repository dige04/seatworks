import { headSha } from "../../core/git.ts";
import { minutesSince } from "../../core/time.ts";
import { type ToolReply, ok } from "../context.ts";
import { askFirstHits, changeOf, landFacts } from "./land-facts.ts";
import type { Lane } from "../../domain/lane.ts";
import { loadLedger } from "../store/ledger.ts";
import { landLetters } from "../letters/land-letters.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

/** A reply to a close, with what kept a landing from happening when something did. */
export type Closed = ToolReply & { blocked?: string };

export type OverGate = { overGate: boolean; reason: string };

export type Held = NonNullable<Lane["landApproval"]>;

const NOT_READY = "Its Lead has not reported it ready as it now stands: never, or the lane was amended since.";

/**
 * What the Human's earlier word still stops: a hold with no commit since stands while it still touches what they asked
 * to be asked about. Out of the loop, their word stops nothing.
 */
export async function waitsForHuman(
  { ledgers, teamFor }: Pick<DeskServices, "ledgers" | "teamFor">,
  project: Project,
  lane: Lane,
  tip: string | undefined,
): Promise<Closed | undefined> {
  if (!teamFor(project).hitl.on) return undefined;
  const held = lane.landApproval;
  if (!held || held.approved || held.head !== tip) return undefined;
  const asks = askFirstHits(project, await changeOf(project, lane));
  if (asks.length === 0) return undefined;
  ledgers.setLane(project, lane.id, (entry) => {
    if (entry.landApproval && !entry.landApproval.approved) entry.landApproval.signals = asks;
  });
  const since = minutesSince(Date.now(), held.since);
  return ok(
    `Lane ${lane.id} still waits for the Human's approval to land, since ${since} min ago. ${asks.join(" ")} LANDED or SENT BACK comes as mail.`,
  );
}

/**
 * Holds a landing for the Human where they asked to be asked first, while they are in the loop; all else it reads goes
 * with it as evidence. An approval stands for what it was given: a path newly asked about holds it again.
 */
export async function checkLanding(
  { kit, ledgers, mail, teamFor }: Pick<DeskServices, "kit" | "ledgers" | "mail" | "teamFor">,
  project: Project,
  lane: Lane,
  gate: { ok: boolean; ran: boolean },
  over: OverGate,
  approved?: Held,
): Promise<{ held?: string; note: string }> {
  const change = await changeOf(project, lane);
  const asks = teamFor(project).hitl.on ? askFirstHits(project, change) : [];
  const facts = await landFacts(kit, project, loadLedger(project.state), lane, change, { set: gate.ran, ok: gate.ok });
  const evidence = [...(lane.ready ? [] : [NOT_READY]), ...facts];
  const fresh = approved ? asks.filter((ask) => !approved.signals.includes(ask)) : asks;
  if (fresh.length === 0)
    return { note: `\n\n${approved ? "The Human approved it.\n" : ""}Evidence: ${evidence.join(" ")}` };
  const head = (await headSha(project.root, lane.branch)) ?? "";
  const reason = over.reason ? { reason: over.reason } : {};
  ledgers.setLane(project, lane.id, (entry) => {
    const hold = { since: Date.now(), head, signals: asks, evidence, overGate: over.overGate, ...reason };
    entry.landApproval = { ...hold, ready: Boolean(lane.ready) };
  });
  recordEvent(project, { kind: "land.held", lane: lane.id, signals: asks.length });
  await mail.post(lane.lead, landLetters.landHeld(lane, asks.join(" "), head));
  return {
    held: `Lane ${lane.id} was not landed: it waits for the Human's approval, on the Flow tab of the panel. ${asks.join(" ")}\n\nEvidence: ${evidence.join(" ")}\n\nYou cannot approve it; tell them it waits, and why. LANDED or SENT BACK comes as mail.`,
    note: "",
  };
}
