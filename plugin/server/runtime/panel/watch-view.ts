import { minutesSince } from "../../core/time.ts";
import { join } from "node:path";
import type { WatchJudge, WatchView } from "../../../shared/flow-views.ts";
import type { Kit } from "../../catalog/kit/kit.ts";
import type { Team } from "../../catalog/team/team.ts";
import { lastBytes } from "../../core/gate.ts";
import { loadIncidents } from "../../desk/store/incidents.ts";
import type { Project } from "../../desk/project/project.ts";

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

/** What the panel shows of a project's watch: how many incidents stand where, and trouble nobody is mailed about. */
export function watchView(project: Project, troubles: Trouble[], team: Team, kit: Kit, now = Date.now()): WatchView {
  const ago = (at: number) => Math.max(0, Math.round((now - at) / 60_000));
  const incidents = { told: 0, held: 0, recorded: 0 };
  for (const item of Object.values(loadIncidents(project.state).items)) {
    if (!item.open) continue;
    incidents[item.told !== undefined ? "told" : item.held ? "held" : "recorded"] += 1;
  }
  return {
    incidents,
    trouble: troubles.map((entry) => ({ kind: entry.kind, minutes: ago(entry.at), detail: entry.detail })).reverse(),
    judge: judgeLine(project, team, kit, now),
  };
}
