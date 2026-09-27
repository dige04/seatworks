import type { Kit } from "../../catalog/kit/kit.ts";
import { branchExists, currentBranch, uncommittedPaths } from "../../core/git.ts";
import { keptFault } from "../../core/store.ts";
import { clip, slugify } from "../../core/text.ts";
import { workKey } from "../claims.ts";
import { type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { type Issue, fetchIssue } from "../../core/issues.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, nextLaneId, ownCopyHolder } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import {
  type LaneHome,
  type Project,
  type ProjectConfig,
  detectGate,
  laneHomeFor,
  readProjectConfig,
  saveConfig,
} from "../project/project.ts";
import type { Refusal } from "../refusal.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { humanSaid } from "../human/said.ts";
import { waitsFor } from "../waiting/rules.ts";
import { openedReply, startLead } from "./lead-seat.ts";
import { placement } from "./placement.ts";

type OpenLaneCall = {
  title: string;
  outcome: string;
  acceptance: string[];
  appetite?: string;
  deadline?: string;
  outOfScope?: string[];
  issue?: string;
  isolate?: boolean;
  base?: string;
  onBranch?: boolean;
  newBranch?: string;
  writeSet?: string[];
  contracts?: string[];
  after?: string[];
  detourOf?: string;
  role?: string;
  humanSaid?: string;
  audit?: boolean;
};

type Place = { base: string; onBranch: boolean; branch?: string };

type Plan = {
  args: OpenLaneCall;
  place: Place;
  after: string[];
  pending: Lane[];
  newBranch: string;
  here?: string;
  home?: LaneHome;
  decided?: string;
  said?: string;
};

/** Opens a lane now, or records it waiting for the lanes it names; a Lead is started for one that opens. */
export async function openLane(desk: DeskServices, caller: Caller, asked: OpenLaneCall): Promise<ToolReply> {
  const { project } = caller;
  const read = readProjectConfig(project.state);
  if ("fault" in read) return no(keptFault(read.fault).message);
  const plan = await planOpen(project, read.config, asked);
  if (typeof plan === "string") return no(plan);
  seedGate(desk.kit, project, read.config);
  const quote = str(asked.humanSaid);
  const said = quote && (await humanSaid(desk.roster, caller.id, quote)) ? quote : undefined;
  const opened = await (plan.pending.length > 0 ? waitToOpen : openNow)(desk, caller, { ...plan, said });
  return opened.ok && quote && !said ? ok(`${opened.text}${UNSAID}`) : opened;
}

const UNSAID =
  "\n\nhumanSaid is no message the Human wrote in your chat, so the Lead was not given it as theirs: pass their words whole, or twenty characters and more of one, to have them reach it.";

/** Checks the call and works out where the lane works: carrying a branch on, or off which base. */
async function planOpen(project: Project, config: ProjectConfig, asked: OpenLaneCall): Promise<Plan | string> {
  const after = [...new Set(strs(asked.after).map((id) => id.trim().toUpperCase()))];
  const here = await currentBranch(project.root);
  const newBranch = str(asked.newBranch).trim();
  if (newBranch && asked.onBranch !== true && config.laneHome !== "onBranch")
    return "newBranch goes with onBranch: it starts the branch the lane then carries on.";
  if (asked.onBranch === true && (asked.isolate !== undefined || str(asked.base)))
    return "onBranch carries on the branch the project's own copy is on, in that copy, so it takes no base and no isolate.";
  // A lane whose `after` has all landed opens now, in whatever the copy is now: it is asked about like any other.
  const waits = after.length > 0 ? waitsFor(loadLedger(project.state), after, true) : [];
  const chosen = await homeOf(project, config, asked, Array.isArray(waits) && waits.length === 0, here);
  if ("refused" in chosen) return chosen.refused;
  const { home, decided } = chosen;
  const args = { ...asked, onBranch: home === "onBranch" || undefined, isolate: home === "isolate" || undefined };
  const onBranch = args.onBranch === true;
  if (onBranch && !here)
    return "The project's own copy is not on a branch, so there is no branch to carry on; open the lane without onBranch to start one.";
  if (newBranch && after.length > 0)
    return "A lane that waits cannot start a branch from the copy as it is now: that is not the copy it will open in. Wait without newBranch, and start the branch when its turn comes.";
  if (newBranch && (await branchExists(project.root, newBranch)))
    return `The branch ${newBranch} already exists: pick another name, or carry it on once the project's own copy is on it.`;
  const pending = after.length > 0 ? waitsFor(loadLedger(project.state), after, onBranch) : [];
  if (typeof pending === "string") return `${pending} Open this lane without waiting for it.`;
  const carried = pending.find((lane) => lane.onBranch)?.branch;
  // With no base on record a lane starts where the Human's copy stands, which a lane holding that copy is not.
  const holder = ownCopyHolder(Object.values(loadLedger(project.state).lanes));
  const from = holder ? holder.base : here;
  const base = onBranch ? (carried ?? (newBranch || here!)) : str(args.base) || config.base || from;
  if (!base)
    return "Nothing names the base this lane starts from: none is on record, and the project's own copy is not on a branch. Pass base, or set_project names one.";
  if (!newBranch && !(await branchExists(project.root, base))) return `The base branch ${base} does not exist.`;
  return {
    args,
    place: { base, onBranch, branch: onBranch ? base : undefined },
    after,
    pending,
    newBranch,
    here,
    home,
    decided,
  };
}

/**
 * Where this lane works, as its call or the standing choice says; with neither, and the project's copy making it a
 * question, a copy of its own, which leaves that copy as it is. A choice that cannot hold there is refused.
 */
async function homeOf(
  project: Project,
  config: ProjectConfig,
  asked: OpenLaneCall,
  opensNow: boolean,
  here: string | undefined,
): Promise<{ home?: LaneHome; decided?: string } | { refused: string }> {
  const said: LaneHome | undefined =
    asked.onBranch === true
      ? "onBranch"
      : asked.isolate === true
        ? "isolate"
        : asked.isolate === false
          ? "newBranch"
          : undefined;
  // A waiting lane opens into the copy as it is by then; one the copy is taken from gets a copy of its own or waits.
  if (!opensNow || ownCopyHolder(Object.values(loadLedger(project.state).lanes)))
    return { home: said ?? config.laneHome };
  const home = laneHomeFor(said, config, here, await uncommittedPaths(project.root, false));
  if (typeof home !== "object") return { home };
  if (said ?? config.laneHome)
    return {
      refused: `Where this lane works cannot be a new branch in the project's own copy while that copy has uncommitted work: ${home.question}. Pass one of those.`,
    };
  return {
    home: "isolate",
    decided: decidedApart(home.question),
  };
}

/** What the Supervisor is told when nothing chose where a lane works and it opened in a copy of its own. */
export const decidedApart = (question: string) =>
  `\n\nNothing on record chose where it works, so it opened in a copy of its own, which leaves the project's own copy as it is: decided for you. The choices were to ${question}; set_project laneHome keeps a choice for every lane.`;

/** The gate detected once while nothing answered it: "" is the project's own answer, no gate. Base is set_project's. */
function seedGate(kit: Kit, project: Project, config: ProjectConfig): void {
  if (config.gate !== undefined) return;
  saveConfig(project.state, { ...config, gate: detectGate(project.root, kit.ecosystem) });
}

async function waitToOpen(desk: DeskServices, caller: Caller, plan: Plan): Promise<ToolReply> {
  const { project } = caller;
  const { issue } = await readIssue(desk.kit, plan.args, project);
  const lane = desk.ledgers.transact(project, (ledger) => {
    const entry = laneOf(ledger, caller, plan, issue, plan.after);
    ledger.lanes[entry.id] = entry;
    return { ...entry };
  });
  recordEvent(project, { kind: "lane.waiting", lane: lane.id, after: plan.after });
  const waited = plan.pending.map((entry) => `${entry.id} (${entry.status})`).join(", ");
  return ok(
    `Lane ${lane.id} waits for ${waited}. It opens by itself once they have all landed, checked again against the lanes open then; if it cannot, or one closes without landing, you get a letter. Close it to drop it.`,
  );
}

async function openNow(desk: DeskServices, caller: Caller, plan: Plan): Promise<ToolReply> {
  const { project } = caller;
  const { args, place } = plan;
  // Asked before the issue is fetched, which a refusal would waste; recording the lane asks again.
  const asked = { onBranch: place.onBranch, detourOf: detourOf(args) };
  const early = placement(loadLedger(project.state), asked, args.isolate === true);
  if ("why" in early) return no(`${early.why} ${early.next}`.trim());
  const { issue, unread } = await readIssue(desk.kit, args, project);
  const placed = recordOpen(desk, caller, plan, issue);
  if ("why" in placed) return no(`${placed.why} ${placed.next}`.trim());
  const { lane } = placed;
  const from = plan.newBranch ? plan.here : undefined;
  const how = {
    ownCopy: placed.ownCopy,
    failed: "close" as const,
    from,
    role: str(args.role),
    parent: caller.id,
    issue,
  };
  const started = await startLead(desk, project, lane, how);
  if (typeof started === "string") return no(started);
  const note = unread
    ? `\n\nThe issue was not read into the lane: ${clip(unread, 300)}. The Lead has it as given, with the outcome and the checks; give it the issue yourself if it cannot read it.`
    : "";
  return ok(
    `${openedReply(project, lane, started.slot, started.lead, issue, started.beside)}${plan.decided ?? ""}${note}`,
  );
}

/** Placed where it is recorded: two lanes opened at once would otherwise both find the project's own copy free. */
function recordOpen(
  desk: Pick<DeskServices, "ledgers" | "seating">,
  caller: Caller,
  plan: Plan,
  issue: Issue | undefined,
): { lane: Lane; ownCopy: boolean } | Refusal {
  return desk.ledgers.transact(caller.project, (ledger) => {
    const lane = laneOf(ledger, caller, plan, issue);
    const placed = placement(ledger, lane, plan.args.isolate === true);
    if ("why" in placed) return placed;
    ledger.lanes[lane.id] = lane;
    desk.seating.take(workKey(caller.project, lane.id));
    return { lane: { ...lane }, ownCopy: placed.ownCopy };
  });
}

const detourOf = (args: OpenLaneCall): string | undefined => str(args.detourOf).trim().toUpperCase() || undefined;

/** The lane as asked for, numbered in `ledger` but not yet on record there. */
function laneOf(
  ledger: Ledger,
  caller: Caller,
  { args, place, home, said }: Pick<Plan, "args" | "place" | "home" | "said">,
  issue: Issue | undefined,
  after?: string[],
): Lane {
  const title = str(args.title);
  const id = nextLaneId(ledger);
  const role = str(args.role);
  // What decides how it opens, kept for when it does: the call that asked for it is long gone by then.
  const kept = home === "onBranch" ? undefined : home;
  const opening = after && (kept || role) ? { home: kept, role: role || undefined } : undefined;
  return {
    id,
    title,
    outcome: str(args.outcome),
    humanSaid: said,
    acceptance: strs(args.acceptance),
    appetite: str(args.appetite) || undefined,
    deadline: str(args.deadline) || undefined,
    outOfScope: strs(args.outOfScope),
    // Kept as given when it could not be read, so the Lead can still reach it itself.
    issue: issue?.url || str(args.issue) || undefined,
    base: place.base,
    branch: place.branch ?? `lane/${id.toLowerCase()}-${slugify(title, 24)}`,
    detourOf: detourOf(args),
    onBranch: place.onBranch || undefined,
    writeSet: strs(args.writeSet),
    contracts: strs(args.contracts),
    audit: args.audit === true || undefined,
    opener: caller.id,
    status: after ? "waiting" : "open",
    after,
    opening,
    openedAt: Date.now(),
    tasks: 0,
  };
}

/** An unreadable issue ref is a note on the lane, never a reason to refuse opening it. */
async function readIssue(kit: Kit, args: OpenLaneCall, project: Project): Promise<{ issue?: Issue; unread?: string }> {
  const ref = str(args.issue);
  if (!ref) return {};
  const fetched = await fetchIssue(kit.ecosystem.issues, ref, project.root);
  return "error" in fetched ? { unread: `${ref} could not be read: ${fetched.error}` } : { issue: fetched };
}
