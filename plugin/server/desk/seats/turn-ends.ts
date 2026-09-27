import { errorText } from "../../core/errors.ts";
import { carryOut } from "../lanes/land-order.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { loadLedger } from "../store/ledger.ts";

type Ended = (agentId: string) => boolean;

/** What waited on ended turns goes on: teardowns they held up, each project's merges, landings held on writers. */
export async function turnsEnded(desk: DeskServices, ended: Ended): Promise<void> {
  await desk.teardowns.stopped(ended);
  for (const project of desk.projects.values()) {
    desk.merges.retry(project).catch((error) => desk.log(project, `merge retry failed: ${errorText(error)}`));
    releaseLandings(desk, project, ended);
  }
}

/** A lane whose landing waited for seats writing in its copy is landed as ordered once the last of them is done. */
function releaseLandings(desk: DeskServices, project: Project, ended: Ended): void {
  const lanes = Object.values(loadLedger(project.state).lanes);
  for (const lane of lanes.filter((entry) => entry.status === "open" && entry.landing?.writers.some(ended))) {
    // Who is left is worked out where it is written: a turn that ended meanwhile must not be written back in the way.
    const order = desk.ledgers.transact(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (!entry?.landing) return undefined;
      entry.landing.writers = entry.landing.writers.filter((id) => !ended(id));
      if (entry.landing.writers.length > 0) return undefined;
      const { landing } = entry;
      delete entry.landing;
      return landing;
    });
    if (order) carryOut(desk, project, lane.id, order);
  }
}
