import type { Kit } from "../../catalog/kit/kit.ts";
import { can, roleNamed, seatOf } from "../../catalog/kit/roles.ts";
import type { SeatView } from "../../core/ports.ts";
import { oneLine } from "../../core/text.ts";
import type { Desk } from "../../desk/desk.ts";
import { askLetters } from "../../desk/letters/ask-letters.ts";
import type { Project } from "../../desk/project/project.ts";
import { loadIncidents, openFor, saidBefore } from "../../desk/store/incidents.ts";
import { ASK, type Ask } from "../../domain/ask.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { TeamSource } from "../team-source.ts";
import { fact } from "../../domain/incident.ts";
import { decide } from "../watch/findings.ts";

type AskDeps = { kit: Kit; desk: Desk; source: TeamSource };

/**
 * An open ask whose reader is gone goes to whoever supervises now. One left waiting is a fact about its reader for the
 * watch, never a reminder on a clock. With the Human out of the loop, a Lead's ask unanswered in the owner's time goes back
 * to the Lead to settle.
 */
export async function dueAsks(
  deps: AskDeps,
  project: Project,
  ledger: Ledger,
  seats: Map<string, SeatView>,
  now: number,
  missingOf: (ids: string[]) => Promise<Set<string>>,
): Promise<void> {
  const team = deps.source.teamFor(project);
  const { askWaitingMinutes, askLapseMinutes } = team.attention;
  const lapses = (ask: Ask) =>
    !team.hitl.on && can(roleNamed(deps.kit, ask.fromRole), "lead") && now - ask.openedAt >= askLapseMinutes * 60_000;
  const open = Object.values(ledger.asks).filter((entry) => entry.status === "open");
  const missing = await missingOf(open.filter((ask) => !seats.has(ask.to)).map((ask) => ask.to));
  const waiting = new Map<string, Ask[]>();
  for (const ask of open) {
    const lane = ask.lane ? ledger.lanes[ask.lane] : undefined;
    if (missing.has(ask.to)) await moveAsk(deps, project, ask, lane, now);
    else if (lapses(ask)) await lapse(deps, project, ask, now);
    else if (now - (ask.remindedAt ?? ask.openedAt) >= askWaitingMinutes * 60_000)
      waiting.set(ask.to, [...(waiting.get(ask.to) ?? []), ask]);
  }
  await waitedOn(deps, project, seats, waiting);
}

/** One fact per reader, naming every ask that waits on it: sighted again while open and untold, never once settled. */
async function waitedOn(
  { kit, desk }: AskDeps,
  project: Project,
  seats: Map<string, SeatView>,
  waiting: Map<string, Ask[]>,
): Promise<void> {
  if (waiting.size === 0) return;
  const book = loadIncidents(project.state);
  for (const [reader, asks] of waiting) {
    const seat = seats.get(reader);
    // The watch tells only whoever supervises, and never about itself.
    if (!seat || can(seatOf(kit, seat.provider)?.role, "supervise")) continue;
    const quote = asks
      .map((ask) => `${ask.id} (${ask.kind}) from ${ask.task ?? ask.lane ?? ask.from}: ${oneLine(ask.text, 160)}`)
      .join("; ");
    const found = fact("ask-waiting", quote);
    const standing = openFor(book, reader, found.kind);
    if (!standing && saidBefore(book, reader, found.kind, quote)) continue;
    if (standing && standing.quote === quote && standing.told !== undefined) continue;
    await desk.notice(project, { id: reader, provider: seat.provider, title: seat.title }, decide([found]));
  }
}

/** Settles a Lead's ask nobody answered in time as its own to decide: the Lead is told, and so is whoever it waited on. */
async function lapse({ desk }: AskDeps, project: Project, ask: Ask, now: number): Promise<void> {
  const minutes = Math.round((now - ask.openedAt) / 60_000);
  const lapsed = desk.transact(project, (current) => {
    const entry = current.asks[ask.id];
    if (!entry || !ASK.may(entry.status, "answer")) return undefined;
    ASK.move(entry, "answer");
    entry.answer = `Nobody answered within ${minutes} minutes: it went back to its Lead to settle.`;
    return { ...entry };
  });
  if (!lapsed) return;
  await desk.post(lapsed.from, askLetters.lapsed(lapsed, minutes));
  await desk.post(lapsed.to, askLetters.lapsedFor(lapsed, minutes));
}

/** An ask whose reader has gone goes to whoever supervises now, a Lead's own ask included. */
async function moveAsk(
  { desk, kit }: AskDeps,
  project: Project,
  ask: Ask,
  lane: Lane | undefined,
  now: number,
): Promise<void> {
  const to = await desk.supervisorFor(project, lane?.opener);
  if (!to || to === ask.to) return;
  const moved = desk.transact(project, (current) => {
    const entry = current.asks[ask.id];
    if (!entry || entry.status !== "open" || entry.to !== ask.to) return undefined;
    entry.to = to;
    entry.remindedAt = now;
    return { ...entry };
  });
  const asker = roleNamed(kit, ask.fromRole)?.label ?? ask.fromRole;
  const from = ask.task
    ? `the ${asker} on ${ask.task}, whose reader is gone`
    : `the ${asker} of ${ask.lane ?? "a lane"}, whose reader is gone`;
  if (moved) await desk.post(to, askLetters.askTo(moved, from, "supervisor"));
}
