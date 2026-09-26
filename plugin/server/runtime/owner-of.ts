import type { RoleSpec } from "../catalog/kit/kit.ts";
import { can } from "../catalog/kit/roles.ts";
import type { Desk } from "../desk/desk.ts";
import { laneOfLead, taskOfPeer } from "../domain/ledger.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import type { Project } from "../desk/project/project.ts";

/** Who hears of a seat that stopped: a Lead's is whoever supervises, a Peer's its Lead, or whoever supervises once it is gone. */
export async function ownerOf(
  desk: Pick<Desk, "readerOf" | "supervisorFor">,
  project: Project,
  agentId: string,
  role: RoleSpec,
): Promise<{ to: string | undefined; reader: "lead" | "supervisor" | "leadGone" }> {
  // A Lead's owner is whoever supervises; an unreadable ledger must not stop its failures reaching anyone.
  if (can(role, "lead")) {
    let opener: string | undefined;
    try {
      opener = laneOfLead(loadLedger(project.state), agentId)?.opener;
    } catch {
      // No opener then: whoever supervises the project is asked.
    }
    return { to: await desk.supervisorFor(project, opener), reader: "supervisor" };
  }
  const ledger = loadLedger(project.state);
  const task = taskOfPeer(ledger, agentId);
  if (!task) return { to: undefined, reader: "lead" };
  // A Lead no longer seated would never read it: whoever supervises is told, and can seat one.
  const reader = await desk.readerOf(project, ledger.lanes[task.lane]);
  return { to: reader.to, reader: reader.as === "lead" ? "lead" : "leadGone" };
}
