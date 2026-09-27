import type { Kit } from "../../catalog/kit/kit.ts";
import { roleNamed } from "../../catalog/kit/roles.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import type { ReportView } from "../../../shared/views.ts";

type Row = ReportView["numbers"][number];

/** Whether work was sent back after a review's verdict: its task's, or for a review of the whole lane, any task's. */
function changedWork(ledger: Ledger, review: Task): boolean {
  const at = review.handback!.at;
  const reviewed = review.of
    ? [ledger.tasks[review.of]]
    : Object.values(ledger.tasks).filter((task) => task.lane === review.lane);
  return reviewed.some((task) => (task?.sentBack ?? []).some((back) => back.at >= at));
}

/**
 * Each mechanism weighed by what it changed, not how often it ran: reviews of a change that sent work back, challenges
 * that changed the plan, and the asks Leads sent up, by kind, since a kind asked again and again points at an instruction.
 */
export function valueNumbers(kit: Kit, ledger: Ledger, since: number): Row[] {
  const reviews = Object.values(ledger.tasks).filter(
    (task) =>
      task.kind === "review" && (task.of || task.scope === "lane") && task.handback && task.handback.at >= since,
  );
  const byRole = new Map<string, [number, number]>();
  for (const review of reviews) {
    const role = roleNamed(kit, review.peer && ledger.agents[review.peer]?.role)?.label ?? "Unknown role";
    const [changed, all] = byRole.get(role) ?? [0, 0];
    byRole.set(role, [changed + (changedWork(ledger, review) ? 1 : 0), all + 1]);
  }
  const changed = [...byRole.values()].reduce((sum, [count]) => sum + count, 0);
  const challenges = Object.values(ledger.asks).filter(
    (ask) => ask.kind === "challenge" && ask.status === "answered" && (ask.movedAt ?? ask.openedAt) >= since,
  );
  const verdicts = (verdict: string) => challenges.filter((ask) => ask.verdict === verdict).length;
  const up = Object.values(ledger.asks).filter((ask) => !ask.task && ask.openedAt >= since);
  const kinds = new Map<string, number>();
  for (const ask of up) kinds.set(ask.kind, (kinds.get(ask.kind) ?? 0) + 1);
  return [
    {
      title: "Reviews",
      value: reviews.length > 0 ? `${changed} of ${reviews.length} changed the work` : "none yet",
      detail:
        reviews.length > 0
          ? [...byRole].map(([role, [count, all]]) => `${role}: ${count} of ${all}`).join(" · ")
          : "No review of a change came back in this window.",
    },
    {
      title: "Challenges",
      value: challenges.length > 0 ? `${verdicts("changes")} of ${challenges.length} changed the plan` : "none yet",
      detail:
        challenges.length > 0
          ? `${verdicts("alternative")} kept as another sound option · ${verdicts("minor")} as not worth stopping for`
          : "No challenge to a brief or a directive was answered in this window.",
    },
    {
      title: "Asks sent up",
      value: `${up.length}`,
      detail:
        up.length > 0
          ? [...kinds].map(([kind, count]) => `${kind} ${count}`).join(" · ")
          : "No Lead asked whoever supervises in this window.",
    },
  ];
}
