import { existsSync } from "node:fs";
import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { SeatView } from "../../core/ports.ts";
import { plural } from "../../core/text.ts";
import { DAY_MS, HOUR_MS, minutesSince } from "../../core/time.ts";
import { keptCopy } from "../seats/kept.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, ownCopyHolder } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { openLaneLines, seatLine, waitingLaneLines } from "./status-lanes.ts";
import {
  type LaneHome,
  type Project,
  type ProjectConfig,
  laneHomeFor,
  loadConfig,
  projectOf,
} from "../project/project.ts";

/** What the status tool read from the project's own checkout; `work` is undefined when git could not say. */
export type OwnCheckout = { branch?: string; head?: string; work?: string[] };

/** A letter the outbox still holds, and when it is given up on. */
type Held = { to: string; text: string; at: number; until: number };

type Seats = Map<string, SeatView>;

const SHOWN_FILES = 10;

const HOMES: Record<LaneHome, string> = {
  onBranch: "carrying on the branch this copy is on",
  newBranch: "on a new branch off the base in this copy",
  isolate: "in a copy of their own",
};

const left = (ms: number) =>
  ms > DAY_MS ? `${Math.ceil(ms / DAY_MS)} days` : `${Math.max(1, Math.ceil(ms / HOUR_MS))} h`;
const opening = (text: string) => text.split(/\r?\n/).find((line) => line.trim()) ?? "";

/** To the minute, like every age on the page: a status asked again within it reads the same when nothing moved. */
const stamp = (now: number): string => `${new Date(now).toISOString().slice(0, 16)}Z`;

/** The whole project's page, as the panel shows it and status.md keeps it: supervisors waiting on the Human included. */
export function statusPage(
  kit: Kit,
  project: Project,
  seats: Seats,
  now: number,
  held: Held[],
  human: boolean,
): string {
  const waiting = [...seats.values()].filter(
    (seat) =>
      can(seatOf(kit, seat.provider)?.role, "supervise") &&
      projectOf(seat.cwd).slug === project.slug &&
      (seat.pendingPermissions?.length ?? 0) > 0,
  );
  return statusText(project, loadLedger(project.state), loadConfig(project.state), seats, now, {
    waiting,
    held,
    human,
  });
}

/** `copy` adds the project's own checkout, and `quoting` the words of open asks, for a seat and never the Human. */
export function statusText(
  project: Project,
  ledger: Ledger,
  config: ProjectConfig,
  seats: Seats,
  now: number,
  {
    laneId,
    waiting = [],
    held = [],
    copy,
    human,
    quoting = false,
  }: { laneId?: string; waiting?: SeatView[]; held?: Held[]; copy?: OwnCheckout; human: boolean; quoting?: boolean },
): string {
  const lanes = Object.values(ledger.lanes).filter((lane) => (laneId ? lane.id === laneId : true));
  const open = lanes.filter((lane) => lane.status === "open");
  const pending = lanes.filter((lane) => lane.status === "waiting");
  const lines = [
    ...heading(project, config, now, human),
    ...(copy ? ownCopyLines(project, ledger, config, copy, human) : []),
    ...mailLines(project, ledger, seats, now, held),
    ...waitingOnHuman(waiting),
    ...(open.length === 0
      ? ["No open lanes.", ""]
      : open.flatMap((lane) => openLaneLines(ledger, lane, seats, now, copy !== undefined))),
    ...waitingLaneLines(ledger, pending, copy !== undefined),
    ...(laneId ? [] : [...keptLines(ledger, seats, now), ...copyLines(ledger), ...leftLines(ledger, now)]),
    ...askLines(ledger, now, laneId, quoting),
    ...(laneId ? [] : [...questionLines(ledger, now), ...closedLines(lanes)]),
  ];
  return `${lines.join("\n")}\n`;
}

/** How the project is set up, and what waits for the Human: nothing while they are out of the loop. */
function heading(project: Project, config: ProjectConfig, now: number, human: boolean): string[] {
  const gate = config.gate || (config.gate === "" ? "none, by this project's own choice" : "none");
  const asked = !human
    ? "The Human is out of the loop: only the concept is theirs, so no landing waits for them and nothing queues for them."
    : config.askFirst.length > 0
      ? `A landing that touches ${config.askFirst.join(", ")} waits for the Human (askFirst).`
      : "No landing waits for the Human (askFirst is empty).";
  const rules = config.riskRules ? `Risk rules of its own: ${config.riskRules.length}.` : "The kit's risk rules.";
  const setup = `Updated ${stamp(now)}. Base ${config.base ?? "unset"}. Gate ${gate}. Lanes land as ${config.landAs}.`;
  return [`# Status: ${project.root}`, "", `${setup} ${asked} ${rules}`, ""];
}

/** A choice of where lanes work, named only where one is real: uncommitted work, or a branch not the base, and no lane. */
function ownCopyLines(
  project: Project,
  ledger: Ledger,
  config: ProjectConfig,
  copy: OwnCheckout,
  human: boolean,
): string[] {
  const at = copy.branch ? `on ${copy.branch}` : `not on a branch (detached at ${copy.head ?? "an unknown commit"})`;
  const work = copy.work ? [...copy.work].sort() : undefined;
  const more = work && work.length > SHOWN_FILES ? `, and ${work.length - SHOWN_FILES} more` : "";
  const files = work ? `${work.length} uncommitted ${plural(work.length, "file", "files")}` : "";
  const state = !work
    ? "and git could not say what is uncommitted"
    : work.length === 0
      ? "clean"
      : `with ${files}: ${work.slice(0, SHOWN_FILES).join(", ")}${more}`;
  const holder = ownCopyHolder(Object.values(ledger.lanes));
  const held =
    holder?.status === "open"
      ? `Lane ${holder.id} is working in it.`
      : holder
        ? `Lane ${holder.id} is closed, and its Lead is ending a turn in it; it goes back to ${holder.base} after.`
        : "No lane is working in it.";
  const lines = ["## The project's own copy", "", `${project.root} is ${at}, ${state}.`, held];
  if (config.laneHome) lines.push(`Lanes open ${HOMES[config.laneHome]}, as chosen for every lane (laneHome).`);
  const home = holder ? undefined : laneHomeFor(undefined, config, copy.branch, work);
  if (typeof home === "object")
    lines.push(
      `Nothing on record chooses where the next lane works, so it opens in a copy of its own unless ${human ? "the Human chooses" : "you choose"} another: ${home.question}.`,
    );
  return [...lines, ""];
}

/** Mail the outbox holds for this project: for seats gone, which nobody else is sent, and for seats that have not taken it. */
function mailLines(project: Project, ledger: Ledger, seats: Seats, now: number, held: Held[]): string[] {
  // One outbox holds every project's mail: a seated recipient belongs to its copy's project, a gone one to this project's record.
  const mine = held.filter((letter) => {
    const seat = seats.get(letter.to);
    return seat ? Boolean(seat.cwd) && projectOf(seat.cwd).slug === project.slug : Boolean(ledger.agents[letter.to]);
  });
  const stranded = mine.filter((letter) => !seats.has(letter.to));
  const queued = mine.filter((letter) => seats.has(letter.to));
  const lines: string[] = [];
  if (stranded.length > 0) {
    const intro = "The seat each of these was addressed to is gone, and no other seat is sent them.";
    lines.push("## Mail with nobody to read it", "", intro, "");
    for (const letter of stranded) {
      const age = `waiting ${minutesSince(now, letter.at)} min, given up on in ${left(letter.until - now)}`;
      lines.push(`- to ${letter.to}, ${age}: ${opening(letter.text).slice(0, 160)}`);
    }
    lines.push("");
  }
  if (queued.length > 0) {
    lines.push("## Mail waiting to be taken", "", "The seat is there and has not read these yet.", "");
    for (const letter of queued)
      lines.push(
        `- to ${letter.to}, waiting ${minutesSince(now, letter.at)} min (${seats.get(letter.to)?.status ?? "unknown"})`,
      );
    lines.push("");
  }
  return lines;
}

function waitingOnHuman(waiting: SeatView[]): string[] {
  if (waiting.length === 0) return [];
  const asked = (seat: SeatView) =>
    (seat.pendingPermissions ?? []).map((request) => request.title ?? request.name ?? "a request").join("; ");
  return [
    "## Waiting on the Human",
    "",
    ...waiting.map((seat) => `- ${seat.title ?? seat.id} (${seat.id}): ${asked(seat)}`),
    "",
  ];
}

/** Leads kept after their lane closed, for whoever supervises to release: how long each has sat idle, and the copy it holds. */
function keptLines(ledger: Ledger, seats: Seats, now: number): string[] {
  const kept = Object.values(ledger.lanes).filter(
    (lane) =>
      lane.status === "closed" && lane.lead && seats.has(lane.lead) && ledger.agents[lane.lead]?.lane === lane.id,
  );
  if (kept.length === 0) return [];
  const line = (lane: Lane) => {
    const copy = keptCopy(ledger, lane) ? `, in ${lane.slot}` : "";
    const how = lane.landed ? "landed" : "dropped";
    return `- ${lane.id} ${lane.title}, ${how}: Lead ${seatLine(seats, lane.lead, now)}${copy}. Kept until it is released.`;
  };
  return ["## Kept Leads", "", ...kept.map(line), ""];
}

function copyLines(ledger: Ledger): string[] {
  const slots = Object.values(ledger.slots);
  if (slots.length === 0) return [];
  const holder = (slot: (typeof slots)[number]) =>
    slot.lane ? `lane ${slot.lane}` : slot.task ? `task ${slot.task}` : "free";
  return ["## Working copies", "", ...slots.map((slot) => `- ${slot.id} ${slot.path}: ${holder(slot)}`), ""];
}

/** Copies let go of with work nobody committed, which the desk never removes: whoever's work it is commits or clears it. */
function leftLines(ledger: Ledger, now: number): string[] {
  const left = Object.entries(ledger.left ?? {}).filter(([path]) => existsSync(path));
  if (left.length === 0) return [];
  return [
    "## Copies left for their uncommitted work",
    "",
    ...left.map(
      ([path, copy]) =>
        `- ${path}, once ${copy.slot}, left ${minutesSince(now, copy.at)} min ago: it ${copy.why}. The desk never removes it; whoever's work it is commits or clears it.`,
    ),
    "",
  ];
}

/** The asks still open; their words only for a seat reading, since a page for the Human holds no agent's words. */
function askLines(ledger: Ledger, now: number, laneId: string | undefined, quoting: boolean): string[] {
  const asks = Object.values(ledger.asks).filter(
    (ask) => ask.status === "open" && (laneId ? ask.lane === laneId : true),
  );
  const line = (ask: (typeof asks)[number]) =>
    `- ${ask.id} ${ask.kind} from ${ask.fromRole} ${ask.from} to ${ask.to}, open ${minutesSince(now, ask.openedAt)} min${quoting ? `: ${opening(ask.text).slice(0, 160)}` : "."}`;
  return ["## Open asks", "", ...(asks.length === 0 ? ["None."] : asks.map(line))];
}

/** The questions still before the Human, each with what goes ahead while they are silent. */
function questionLines(ledger: Ledger, now: number): string[] {
  const open = Object.values(ledger.questions).filter((question) => question.status === "open");
  if (open.length === 0) return [];
  const line = (question: (typeof open)[number]) => {
    const where = `${question.class}${question.lane ? `, ${question.lane}` : ""}`;
    const ask = question.question.slice(0, 160);
    return `- ${question.id} (${where}), open ${minutesSince(now, question.openedAt)} min: ${ask} Recommended: ${question.recommend}. While silent: ${question.ifSilent.slice(0, 160)}`;
  };
  return ["", "## Questions for the Human", "", ...open.map(line)];
}

function closedLines(lanes: Lane[]): string[] {
  const closed = lanes.filter((lane) => lane.status === "closed").slice(-5);
  if (closed.length === 0) return [];
  return ["", "## Recently closed", "", ...closed.map((lane) => `- ${lane.id} ${lane.title} (${lane.branch})`)];
}
