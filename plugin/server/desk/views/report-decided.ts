import type { Kit } from "../../catalog/kit/kit.ts";
import { minutesSince } from "../../core/time.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { ReportItem } from "../../../shared/views.ts";
import type { DatedEvent } from "./events-since.ts";
import { seatPhrase } from "./report-seats.ts";

/**
 * What a seat decided that would have been the Human's to watch: pushes and tags, merges and landings over a red gate,
 * permissions given or refused for them, oldest first; the reasons are the words of whoever decided.
 */
export function decidedFor(kit: Kit, ledger: Ledger, events: DatedEvent[], now: number): ReportItem[] {
  const who = (id: string) => seatPhrase(kit, ledger, id);
  const by = (id: string, reason?: string) => `by ${who(id)}${reason ? `: ${reason}` : ""}`;
  return events.flatMap((event): ReportItem[] => {
    const minutes = minutesSince(now, event.at);
    switch (event.kind) {
      case "base.pushed":
        return [
          {
            title: `Pushed ${event.base} to ${event.remote}${event.tag ? `, tagged ${event.tag}` : ""}`,
            detail: by(event.by),
            minutes,
          },
        ];
      case "gate.overridden":
        return [
          {
            title: event.task ? `${event.task} accepted over a red gate` : `${event.lane} landed over a red gate`,
            detail: by(event.by, event.reason),
            minutes,
          },
        ];
      case "permission.answered":
        return [
          {
            title: `${event.allow ? "Allowed" : "Refused"} a permission for ${who(event.agent)}`,
            detail: by(event.by),
            minutes,
          },
        ];
      default:
        return [];
    }
  });
}
