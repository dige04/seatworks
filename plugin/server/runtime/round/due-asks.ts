import type { Kit } from "../../catalog/kit/kit.ts";
import { can, roleNamed } from "../../catalog/kit/roles.ts";
import type { SeatView } from "../../core/ports.ts";
import type { Desk } from "../../desk/desk.ts";
import { askLetters } from "../../desk/letters/ask-letters.ts";
import type { Project } from "../../desk/project/project.ts";
import { ASK, type Ask } from "../../domain/ask.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { TeamSource } from "../team-source.ts";

type AskDeps = { kit: Kit; desk: Desk; source: TeamSource };

/**
 * An open ask whose reader is gone goes to whoever supervises now; one waiting on an idle reader is reminded, then escalated.
 * With the Human out of the loop, a Lead's ask left unanswered past every reminder's time goes back to the Lead to settle.
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
  const { askRemindMinutes, maxReminders } = team.attention;
  const waited = (ask: Ask) => now - (ask.remindedAt ?? ask.openedAt) >= askRemindMinutes * 60_000;
  const lapses = (ask: Ask) =>
    !team.hitl.on &&
    can(roleNamed(deps.kit, ask.fromRole), "lead") &&
    now - ask.openedAt >= askRemindMinutes * (maxReminders + 1) * 60_000;
  const open = Object.values(ledger.asks).filter((entry) => entry.status === "open");
  const missing = await missingOf(open.filter((ask) => !seats.has(ask.to)).map((ask) => ask.to));
  for (const ask of open) {
    const lane = ask.lane ? ledger.lanes[ask.lane] : undefined;
    if (missing.has(ask.to)) await moveAsk(deps, project, ask, lane, now);
    else if (lapses(ask)) await lapse(deps, project, ask, now);
    else if (seats.get(ask.to)?.status === "idle" && waited(ask))
      await remind(deps, project, ask, lane, now, maxReminders);
  }
}

/** Settles a Lead's ask nobody answered in time as its own to decide: the Lead is told, and so is whoever it waited on. */
async function lapse({ desk }: AskDeps, project: Project, ask: Ask, now: number): Promise<void> {
  const lapsed = desk.transact(project, (current) => {
    const entry = current.asks[ask.id];
    if (!entry || !ASK.may(entry.status, "answer")) return undefined;
    ASK.move(entry, "answer");
    entry.answer = "Nobody answered in time; the Lead settled it from what it had.";
    return { ...entry };
  });
  if (!lapsed) return;
  const minutes = Math.round((now - lapsed.openedAt) / 60_000);
  await desk.post(lapsed.from, askLetters.lapsed(lapsed, minutes));
  await desk.post(lapsed.to, askLetters.lapsedFor(lapsed, minutes));
}

/** An ask whose reader has gone goes to whoever supervises now, a Lead's own ask included. */
async function moveAsk(
  { desk }: AskDeps,
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
  const from = ask.task
    ? `the Peer on ${ask.task}, whose reader is gone`
    : `the Lead of ${ask.lane ?? "a lane"}, whose reader is gone`;
  if (moved) await desk.post(to, askLetters.askTo(moved, from, "supervisor"));
}

/** Reminded up to the owner's count, then escalated from a Lead once; an ask already before whoever supervises has nowhere further up. */
async function remind(
  { desk, kit }: AskDeps,
  project: Project,
  ask: Ask,
  lane: Lane | undefined,
  now: number,
  maxReminders: number,
): Promise<void> {
  const age = Math.round((now - ask.openedAt) / 60_000);
  const reminding = ask.reminders < maxReminders;
  if (reminding) {
    await desk.post(ask.to, askLetters.reminder(ask, age));
  } else if (ask.to === lane?.lead && !can(roleNamed(kit, ask.fromRole), "lead") && !ask.escalated) {
    const to = await desk.supervisorFor(project, lane?.opener);
    // Marked escalated only once delivered; with nobody seated it is retried next round.
    if ((await desk.post(to, askLetters.escalated(ask, age, ask.lane ?? "the project"))) === "nobody") return;
  } else return;
  // Pinned to this round's count so overlapping rounds cannot push it past the owner's maximum.
  desk.transact(project, (current) => {
    const entry = current.asks[ask.id];
    if (!entry || entry.reminders !== ask.reminders) return;
    if (reminding) entry.reminders += 1;
    else entry.escalated = true;
    entry.remindedAt = now;
  });
}
