import type { SeatView } from "../../core/ports.ts";
import type { DeskBase } from "../base.ts";
import type { Project } from "../project/project.ts";

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
