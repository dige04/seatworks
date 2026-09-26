import type { DeskBase } from "../base.ts";
import type { Project } from "../project/project.ts";
import type { Roster } from "./roster.ts";

/** Marks a seat's binding gone: nothing hands it work or counts it as kept from here on, whatever Paseo lists. */
export function markGone({ ledgers }: Pick<DeskBase, "ledgers">, project: Project, agentId: string): void {
  ledgers.transact(project, (ledger) => {
    const bound = ledger.agents[agentId];
    if (bound) bound.gone = true;
  });
}

/** Lets a seat go: its binding says so before Paseo archives it, which waits for a turn under way unless forced. */
export async function letGo(
  desk: Pick<DeskBase, "ledgers">,
  roster: Roster,
  project: Project,
  agentId: string | undefined,
  force = false,
): Promise<void> {
  if (!agentId) return;
  markGone(desk, project, agentId);
  await roster.archive(agentId, force);
}
