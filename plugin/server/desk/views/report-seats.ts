import type { Kit } from "../../catalog/kit/kit.ts";
import { can, roleNamed } from "../../catalog/kit/roles.ts";
import type { Ledger } from "../../domain/ledger.ts";

/** A seat as the Report names it, by its role's label and the work it holds, never by its words: "the Peer on L1-T2". */
export function seatPhrase(kit: Kit, ledger: Ledger, id: string, roleId?: string): string {
  const role = roleNamed(kit, roleId ?? ledger.agents[id]?.role);
  const task = Object.values(ledger.tasks).find((entry) => entry.peer === id);
  const lane = Object.values(ledger.lanes).find((entry) => entry.lead === id);
  const label = role?.label ?? "seat";
  if (task && !can(role, "supervise")) return `the ${label} on ${task.id}`;
  if (lane && !can(role, "supervise")) return `the ${label} of ${lane.id}`;
  return role ? `the ${label}` : id;
}
