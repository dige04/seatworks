import type { Kit } from "../../catalog/kit/kit.ts";
import { can, roleNamed } from "../../catalog/kit/roles.ts";
import { KEPT_AS, type Verdict } from "../../domain/ask.ts";
import type { Ask } from "../../domain/ask.ts";
import type { Ledger } from "../../domain/ledger.ts";

/** A seat as the report names it, by its role's label and the work it holds, never by its words: "the Peer on L1-T2". */
export function seatPhrase(kit: Kit, ledger: Ledger, id: string, roleId?: string): string {
  const role = roleNamed(kit, roleId ?? ledger.agents[id]?.role);
  const task = Object.values(ledger.tasks).find((entry) => entry.peer === id);
  const lane = Object.values(ledger.lanes).find((entry) => entry.lead === id);
  const label = role?.label ?? "seat";
  if (task && !can(role, "supervise")) return `the ${label} on ${task.id}`;
  if (lane && !can(role, "supervise")) return `the ${label} of ${lane.id}`;
  return role ? `the ${label}` : id;
}

/** A challenge the plan was kept against, in the record's words: who disputed what, then who kept the plan, how and why. */
export function challengeWords(
  kit: Kit,
  ledger: Ledger,
  ask: Ask & { verdict: Exclude<Verdict, "changes"> },
): [string, string] {
  const disputed = ask.disputes ?? ask.text.split("\n")[0]!.trim();
  const keeper = seatPhrase(kit, ledger, ask.answeredBy ?? ask.to);
  return [
    `${seatPhrase(kit, ledger, ask.from)} disputed "${disputed}"`,
    `${keeper} kept the plan as ${KEPT_AS[ask.verdict]}: ${ask.why ?? ""}`,
  ];
}
