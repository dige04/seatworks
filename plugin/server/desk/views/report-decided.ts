import type { Kit } from "../../catalog/kit/kit.ts";
import { minutesSince } from "../../core/time.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { ReportItem } from "../../../shared/views.ts";
import type { DatedEvent } from "./events-since.ts";
import { seatPhrase } from "./report-seats.ts";

/**
 * What a seat decided that would have been the Human's to watch: pushes and tags, merges and landings over a red gate,
 * permissions given or refused for them, asks a Lead settles for want of an answer, oldest first; the reasons are the words of whoever decided.
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
      case "ask.lapsed":
        return [
          {
            title: `${event.ask} went back to ${who(event.from)} to settle`,
            detail: `nobody answered in ${event.minutes} minutes: ${event.text}`,
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

/**
 * What the Human wrote straight into a Lead's or Peer's chat, and whether it reached the plan the lane keeps: an
 * amendment of that task or lane, or a rework of the task, after it. Their own words, which the report may show.
 */
export function yoursFor(kit: Kit, ledger: Ledger, events: DatedEvent[], now: number): ReportItem[] {
  return events.flatMap((event): ReportItem[] => {
    if (event.kind !== "human.wrote") return [];
    const at = Date.parse(event.at);
    const task = event.task ? ledger.tasks[event.task] : undefined;
    const lane = ledger.lanes[event.lane];
    const after = (entries: { at: number }[] | undefined) => (entries ?? []).some((entry) => entry.at >= at);
    const carried = after(task?.amended)
      ? "carried in: its brief was amended after it"
      : after(task?.sentBack)
        ? "carried in: the task was sent back with a rework after it"
        : after(lane?.amended)
          ? "carried in: the lane's directive was amended after it"
          : "not carried into its brief or directive yet";
    const words = event.text.replace(/\s+/g, " ").trim();
    return [
      {
        title: `To ${seatPhrase(kit, ledger, event.seat)}: "${words.length > 120 ? `${words.slice(0, 117)}...` : words}"`,
        detail: carried,
        minutes: minutesSince(now, event.at),
      },
    ];
  });
}
