import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { SeatView } from "../../core/ports.ts";
import { minutesSince } from "../../core/time.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Question } from "../../domain/question.ts";
import type { ReportItem } from "../../../shared/views.ts";
import { type Project, projectOf } from "../project/project.ts";
import { seatPhrase } from "./report-seats.ts";

/** How much a wait holds up, widest first: whoever supervises, a whole lane, a Lead or a landing, one decision, one seat. */
const WIDTH = { supervisor: 0, lane: 1, lead: 2, step: 3, seat: 4 } as const;

type Need = ReportItem & { width: number };

/** The seats Paseo lists now, and when the plugin heard each one's request, which Paseo does not say; or why it could not list them. */
export type Seated =
  { seats: SeatView[]; heardAt: (seat: string, request: string) => number | undefined } | { error: string };

/** A question holds something up while its lane is on hold for it, or while it is irreversible: nothing it decides goes ahead. */
export const stops = (question: Question) => question.parked === true || question.class === "irreversible";

function questionNeeds(ledger: Ledger, now: number): Need[] {
  return Object.values(ledger.questions)
    .filter((question) => question.status === "open" && stops(question))
    .map((question) => {
      const where = `${question.class}${question.lane ? ` · ${question.lane}` : ""}`;
      const lane = question.parked === true && question.lane;
      return {
        title: `${question.id} · ${question.question}`,
        detail: `${where} · ${lane ? `stops lane ${lane}` : "stops what it decides"}`,
        minutes: minutesSince(now, question.openedAt),
        width: lane ? WIDTH.lane : WIDTH.step,
      };
    });
}

function landingNeeds(ledger: Ledger, now: number): Need[] {
  return Object.values(ledger.lanes)
    .filter((lane) => lane.status === "open" && lane.landApproval && !lane.landApproval.approved)
    .map((lane) => ({
      title: `${lane.id} ${lane.title} waits for you to land it`,
      detail: [...lane.landApproval!.signals, "stops its landing"].join(" · "),
      minutes: minutesSince(now, lane.landApproval!.since),
      width: WIDTH.lead,
    }));
}

/** Out of the loop, a Lead's or Peer's permission is the Supervisor's to give: only whoever supervises waits on the Human then. */
function permissionNeeds(
  kit: Kit,
  project: Project,
  ledger: Ledger,
  seated: Seated,
  human: boolean,
  now: number,
): Need[] {
  if ("error" in seated)
    return [
      {
        title: "Paseo did not say which seats wait for your permission",
        detail: seated.error,
        minutes: 0,
        width: WIDTH.supervisor,
      },
    ];
  return seated.seats.flatMap((seat) => {
    const role = seatOf(kit, seat.provider)?.role;
    if (!role || seat.archivedAt || !seat.cwd || projectOf(seat.cwd).slug !== project.slug) return [];
    const supervises = can(role, "supervise");
    if (!human && !supervises) return [];
    const width = supervises ? WIDTH.supervisor : can(role, "lead") ? WIDTH.lead : WIDTH.seat;
    return (seat.pendingPermissions ?? []).map((request) => ({
      title: `${seat.title ?? seat.id} waits for your ${request.kind === "question" ? "answer" : "permission"}: ${request.title ?? request.name ?? "a request"}`,
      detail: `stops ${seatPhrase(kit, ledger, seat.id, role.role)}`,
      minutes: minutesSince(now, seated.heardAt(seat.id, request.id) ?? seat.updatedAt),
      width,
    }));
  });
}

/** What waits on the Human now, whenever it started: what holds up the most first, and the longest wait first within that. */
export function needsOf(
  kit: Kit,
  project: Project,
  ledger: Ledger,
  seated: Seated,
  human: boolean,
  now: number,
): ReportItem[] {
  return [
    ...permissionNeeds(kit, project, ledger, seated, human, now),
    ...questionNeeds(ledger, now),
    ...landingNeeds(ledger, now),
  ]
    .sort((a, b) => a.width - b.width || b.minutes - a.minutes)
    .map(({ title, detail, minutes }) => ({ title, detail, minutes }));
}
