import { minutesSince } from "../../core/time.ts";
import { join } from "node:path";
import type { WatchJudge, WatchView } from "../../../shared/flow-views.ts";
import type { Kit } from "../../catalog/kit/kit.ts";
import type { Team } from "../../catalog/team/team.ts";
import { lastBytes } from "../../core/gate.ts";
import { loadIncidents } from "../../desk/store/incidents.ts";
import { type Ledger, laneOfLead, taskOfPeer } from "../../domain/ledger.ts";
import { loadLedger } from "../../desk/store/ledger.ts";
import type { Project } from "../../desk/project/project.ts";
import { type Incident, factTitle } from "../../domain/incident.ts";
import { seatOf } from "../../catalog/kit/roles.ts";

const INCIDENTS_SHOWN = 200;

export type Trouble = { kind: string; at: number; detail: string };

/** Which brains read for the project and how that stands, as the last answer the watch kept says; a line by another is not theirs. */
function judgeLine(project: Project, team: Team, kit: Kit, now: number): WatchJudge {
  const { sensor, seat } = team.brains;
  if (!sensor && !seat) return { label: "", state: "off", minutes: null, detail: null };
  const seatLabel = seat && `the ${kit.roles.find((role) => role.role === seat)?.label ?? seat}`;
  const named = [sensor?.sensor.label, seatLabel].filter(Boolean).join(" and ");
  const label = named.charAt(0).toUpperCase() + named.slice(1);
  if (sensor && !sensor.key && !seat) return { label, state: "nokey", minutes: null, detail: sensor.sensor.key };
  let last: { at?: string; by?: string; unasked?: string } | undefined;
  for (const kept of lastBytes(join(project.state, "assessments.log"), 16 * 1024)
    .trim()
    .split("\n")
    .reverse()) {
    try {
      last = JSON.parse(kept) as NonNullable<typeof last>;
      break;
    } catch {
      // A line cut mid-write says nothing of how the brains answer.
    }
  }
  if (!last?.at || (last.by !== sensor?.id && last.by !== seat))
    return { label, state: "waiting", minutes: null, detail: null };
  const minutes = minutesSince(now, last.at);
  return last.unasked
    ? { label, state: "failing", minutes, detail: last.unasked }
    : { label, state: "answering", minutes, detail: null };
}

/** What the panel shows of a project's watch: open incidents, pages first, each named by its seat's place, and trouble nobody is mailed about. */
export function watchView(project: Project, troubles: Trouble[], team: Team, kit: Kit, now = Date.now()): WatchView {
  const ago = (at: number) => Math.max(0, Math.round((now - at) / 60_000));
  let ledger: Ledger | undefined;
  try {
    ledger = loadLedger(project.state);
  } catch {
    // A ledger that cannot be read leaves each seat named by what Paseo calls it.
  }
  const nameOf = (item: Incident) => {
    const role = seatOf(kit, item.provider)?.role.label;
    const task = ledger ? taskOfPeer(ledger, item.seat) : undefined;
    const lane = task || !ledger ? undefined : laneOfLead(ledger, item.seat);
    const work = task ? `${task.id} ${task.title}` : lane && `${lane.id} ${lane.title}`;
    return role && work ? `${role} · ${work}` : item.where;
  };
  const incidents = Object.values(loadIncidents(project.state).items)
    .filter((item) => item.open)
    .sort((a, b) => (a.level === b.level ? b.last - a.last : a.level === "page" ? -1 : 1))
    .slice(0, INCIDENTS_SHOWN)
    .map((item) => ({
      id: item.id,
      title: factTitle(item.kind) ?? item.kind.replace(/[-_]/g, " "),
      level: item.level,
      name: nameOf(item),
      minutes: ago(item.last),
      quote: item.quote.replace(/\s+/g, " ").slice(0, 300),
      told: item.told !== undefined,
      lane: item.lane ?? null,
      held: item.told === undefined ? (item.held ?? null) : null,
    }));
  return {
    incidents,
    trouble: troubles.map((entry) => ({ kind: entry.kind, minutes: ago(entry.at), detail: entry.detail })).reverse(),
    judge: judgeLine(project, team, kit, now),
  };
}
