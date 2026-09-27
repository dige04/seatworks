import type { SeatView } from "../../core/ports.ts";
import { laneSpent } from "../../domain/ledger.ts";
import type { DeskBase } from "../base.ts";
import { workLetters } from "../letters/work-letters.ts";
import type { Project } from "../project/project.ts";
import { recordEvent } from "../store/event-log.ts";
import type { Roster } from "./roster.ts";

/**
 * Keeps what each seat's agent reports it spent. An agent's count starts again with its agent, so a lower count than
 * the last is a new start, and what the last one reached is kept beside it.
 */
export function recordSpend({ ledgers }: Pick<DeskBase, "ledgers">, project: Project, seats: Iterable<SeatView>): void {
  const reported = [...seats].flatMap((seat) => {
    const cost = seat.lastUsage?.totalCostUsd;
    return typeof cost === "number" && Number.isFinite(cost) ? [[seat.id, cost] as const] : [];
  });
  if (reported.length === 0) return;
  const known = ledgers.read(project).agents;
  const changed = reported.filter(([id, cost]) => known[id] && known[id].spent?.last !== cost);
  if (changed.length === 0) return;
  ledgers.transact(project, (ledger) => {
    for (const [id, cost] of changed) {
      const agent = ledger.agents[id];
      if (!agent) continue;
      const was = agent.spent ?? { banked: 0, last: 0 };
      agent.spent = { banked: was.banked + (cost < was.last ? was.last : 0), last: cost };
    }
  });
}

/** An appetite given in dollars, as "$20" or "20 USD"; none for one given another way, such as "two days". */
function dollarsOf(appetite: string | undefined): number | undefined {
  const match = appetite?.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:usd|dollars?)\b/i);
  const value = match ? Number(match[1] ?? match[2]) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Each open lane whose seats spent past the dollars its appetite named, told once to whoever supervises: what a lane
 * costs past what was agreed is the Human's to decide, in the loop or out of it.
 */
export async function tellPastAppetite(
  { ledgers, mail, roster }: Pick<DeskBase, "ledgers" | "mail"> & { roster: Pick<Roster, "supervisorFor"> },
  project: Project,
): Promise<void> {
  const now = Date.now();
  const past = ledgers.transact(project, (ledger) =>
    Object.values(ledger.lanes).flatMap((lane) => {
      const worth = dollarsOf(lane.appetite);
      const spent = laneSpent(ledger, lane.id);
      if (lane.status !== "open" || lane.pastAppetite || worth === undefined || spent === undefined || spent <= worth)
        return [];
      lane.pastAppetite = { at: now, spent };
      return [{ lane: { ...lane }, spent, worth }];
    }),
  );
  for (const { lane, spent, worth } of past) {
    recordEvent(project, { kind: "lane.pastAppetite", lane: lane.id, spent, worth });
    await mail.post(await roster.supervisorFor(project, lane.opener), workLetters.pastAppetite(lane, spent, worth));
  }
}
