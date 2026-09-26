import type { Kit } from "../../catalog/kit/kit.ts";
import { roleNamed } from "../../catalog/kit/roles.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Mark } from "../../domain/task.ts";
import type { ReportView } from "../../../shared/views.ts";

/**
 * How the findings a review made fared when a later review of the same work marked them, by the role that made them:
 * a reviewer whose findings are seldom resolved, or often wrong, is one whose word counts for less.
 */
export function recheckNumbers(kit: Kit, ledger: Ledger, since: number): ReportView["numbers"][number] {
  const byRole = new Map<string, Record<Mark, number>>();
  for (const review of Object.values(ledger.tasks)) {
    const marks = review.handback?.marks;
    const earlier = review.rechecks && ledger.tasks[review.rechecks.review];
    if (!marks || !earlier || review.handback!.at < since) continue;
    const role = roleNamed(kit, earlier.peer && ledger.agents[earlier.peer]?.role)?.label ?? "Unknown role";
    const counts = byRole.get(role) ?? { resolved: 0, open: 0, wrong: 0 };
    for (const mark of marks) counts[mark]++;
    byRole.set(role, counts);
  }
  const all = [...byRole.values()];
  const resolved = all.reduce((sum, counts) => sum + counts.resolved, 0);
  const marked = all.reduce((sum, counts) => sum + counts.resolved + counts.open + counts.wrong, 0);
  return {
    title: "Findings re-checked",
    value: marked > 0 ? `${resolved} of ${marked} resolved` : "none yet",
    detail:
      marked > 0
        ? [...byRole]
            .map(
              ([role, counts]) =>
                `${role}: ${counts.resolved} resolved, ${counts.open} still open, ${counts.wrong} wrong`,
            )
            .join(" · ")
        : "No review marked an earlier review's findings in this window.",
  };
}
