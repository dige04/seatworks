import { changedFiles, diffCounts, kindOf } from "../../core/git-diff.ts";
import { commitsAhead, git, mergeBase, untrackedPaths } from "../../core/git.ts";
import { coverOf, globToRegex, uncovered } from "../../core/scope.ts";
import { capped, plural } from "../../core/text.ts";
import type { Kit } from "../../catalog/kit/kit.ts";
import { fileKinds, testMarkers, weakened } from "../../catalog/kit/ecosystem-patterns.ts";
import { SETTLED } from "../../domain/task.ts";
import { loadIncidents } from "../store/incidents.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, tasksOf } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { type Project, readProjectConfig, serialOnlyOf } from "../project/project.ts";
import { besideText, openWriters } from "./placement.ts";

type LandGate = { set: boolean; ok: boolean };

/** What a lane changed, from where it left base, or where an onBranch lane began on a branch with earlier history. */
type Change = { from?: string; files?: string[] };

const counted = (count: number, word: string) => `${count} ${plural(count, word, `${word}s`)}`;

const SHOWN = 5;

type Reviewed = Task & { handback: NonNullable<Task["handback"]> };

type Over = { task: string; review: string; outcome: string; again: boolean; since: boolean };

/** A lane's reviews as the record has them, by when each came back rather than when it was asked for. */
function reviewRecord(
  ledger: Ledger,
  lane: Lane,
): { whole: boolean; latest?: Reviewed; after: string[]; over: Over[] } {
  const tasks = tasksOf(ledger, lane.id);
  const reviews = tasks
    .filter((task): task is Reviewed => task.kind === "review" && task.handback !== undefined)
    .sort((a, b) => a.handback.at - b.handback.at);
  const accepted = tasks.filter(
    (task): task is Task & { acceptedAt: number } =>
      task.kind === "code" && task.status === "merged" && task.acceptedAt !== undefined,
  );
  const latest = reviews.at(-1);
  const after = latest ? accepted.filter((task) => task.acceptedAt > latest.handback.at).map((task) => task.id) : [];
  const over = accepted.flatMap((task): Over[] => {
    const own = reviews.filter((review) => review.of === task.id && review.handback.at < task.acceptedAt).at(-1);
    if (!own || own.handback.outcome === "accept") return [];
    const since = reviews.some(
      (review) =>
        (!review.of || review.of === task.id) &&
        review.handback.outcome === "accept" &&
        review.handback.at > task.acceptedAt,
    );
    return [
      {
        task: task.id,
        review: own.id,
        outcome: own.handback.outcome,
        again: (task.handback?.at ?? 0) > own.handback.at,
        since,
      },
    ];
  });
  return { whole: reviews.some((review) => !review.of), latest, after, over };
}

/**
 * What a lane's reviews leave standing: no review of the whole lane, a latest review that did not accept, a task
 * accepted over its review's changes or on a later hand-back no review read. Evidence, never a refusal.
 */
export function reviewFacts(ledger: Ledger, lane: Lane): string[] {
  const { whole, latest, after, over } = reviewRecord(ledger, lane);
  const facts = whole ? [] : ["No review of the whole lane is on record."];
  if (latest && latest.handback.outcome !== "accept") {
    const since =
      after.length > 0
        ? `; ${after.join(", ")} ${after.length === 1 ? "was" : "were"} accepted after it, with no review since.`
        : ", and nothing was accepted after it.";
    facts.push(`The lane's latest review, ${latest.id}, ended in ${latest.handback.outcome}${since}`);
  }
  for (const entry of over) {
    if (!entry.again)
      facts.push(`${entry.task} was accepted over ${entry.review}, a review of it that ended in ${entry.outcome}.`);
    else if (!entry.since)
      facts.push(
        `${entry.task} was handed back again after ${entry.review}, a review of it that ended in ${entry.outcome}, and accepted with no review since.`,
      );
  }
  return facts;
}

/**
 * Whether reviews asked for changes the record shows no answer to: the lane's latest review, with nothing accepted
 * after it, or a task accepted on the very hand-back its own review did not accept, with no review accepting it since.
 */
export function changesStanding(ledger: Ledger, lane: Lane): boolean {
  const { latest, after, over } = reviewRecord(ledger, lane);
  return (
    (latest !== undefined && latest.handback.outcome !== "accept" && after.length === 0) ||
    over.some((entry) => !entry.again && !entry.since)
  );
}

export async function changeOf(project: Project, lane: Lane): Promise<Change> {
  const from = lane.onBranch ? lane.startSha : await mergeBase(project.root, lane.base, lane.branch);
  return { from, files: from ? await changedFiles(project.root, `${from}..${lane.branch}`) : undefined };
}

/** Why landing waits for the Human; `path` is the askFirst entry hit, none when the orders or the change are unread. */
export type AskHit = { path?: string; text: string };

/** Why landing `change` waits for the Human: paths it touches they asked to be asked about first, or orders unread. */
export function askFirstHits(project: Project, change: Change): AskHit[] {
  const read = readProjectConfig(project.state);
  if ("fault" in read)
    return [
      { text: `The Human's standing orders cannot be read (${read.fault}), so no landing goes ahead without them.` },
    ];
  const { askFirst } = read.config;
  if (askFirst.length === 0) return [];
  const files = change.files;
  if (!files)
    return [
      {
        text: "What the lane changed could not be read, so it is not known to stay clear of what the Human asked to be asked about first.",
      },
    ];
  return askFirst.flatMap((path) => {
    const cover = coverOf(path);
    const hit = files.filter((file) => cover.test(file));
    return hit.length > 0
      ? [
          {
            path,
            text: `It changes ${capped(hit, SHOWN)}, under ${path}, which the Human asked to be asked about first.`,
          },
        ]
      : [];
  });
}

/** Work closing a lane would lose: a code task not merged, or a review still reading; one that handed back is done. */
export function unfinished(task: Task): boolean {
  return !SETTLED.includes(task.status) && !(task.kind === "review" && task.status === "done");
}

/**
 * What a lane brings onto its base, read from git and the record rather than from anything a seat said: evidence for
 * whoever lands it and the Human, never a reason to hold it. `gate` is left out where its own verdict is given.
 */
export async function landFacts(
  kit: Kit,
  project: Project,
  ledger: Ledger,
  lane: Lane,
  change: Change,
  gate?: LandGate,
): Promise<string[]> {
  const { root } = project;
  const { from } = change;
  if (!from) return [`What ${lane.branch} changed could not be read from git.`, ...reviewFacts(ledger, lane)];
  const serial = serialOnlyOf(project, kit).map((rule) => globToRegex(rule));
  const oneWriter = (path: string) => serial.some((rule) => rule.test(path));
  const counts = await diffCounts(root, from, lane.branch, fileKinds(kit), oneWriter);
  const files = [...new Set(counts?.files ?? [])];
  const writers = openWriters(ledger, lane.id, files.filter(oneWriter));
  const lines = counts ? counts.src + counts.test + counts.docs : 0;
  const commits = await commitsAhead(root, from, lane.branch);
  const outside =
    lane.writeSet.length > 0
      ? uncovered(files, lane.writeSet).map(
          (path) => `${path} is outside the lane's write set, ${lane.writeSet.join(", ")}.`,
        )
      : [];
  return [
    `${commits === undefined ? "Commits unknown" : counted(commits, "commit")}; ${counted(files.length, "file")}, ${counted(lines, "line")} changed.`,
    ...(!gate
      ? []
      : !gate.set
        ? ["Gate: none set, so nothing ran the lane's checks."]
        : [`Gate: ${gate.ok ? "passed" : "failed"} on the lane.`]),
    ...(await testFacts(kit, root, from, lane.branch, files)),
    ...outside,
    ...(await untrackedFacts(lane)),
    ...(writers.length > 0
      ? [`It changed what one writer at a time may write, which open lanes may write too: ${besideText(writers)}.`]
      : []),
    ...recordFacts(project, ledger, lane),
  ];
}

/** In the Human's own checkout, what git does not track is theirs and stops nothing, but it neither lands nor goes. */
async function untrackedFacts(lane: Lane): Promise<string[]> {
  if (lane.slot || !lane.worktree) return [];
  const files = await untrackedPaths(lane.worktree);
  if (files?.length === 0) return [];
  return files
    ? [`The project's own copy holds files git does not track, which do not land: ${capped(files, SHOWN)}.`]
    : ["What the project's own copy holds untracked could not be read from git."];
}

/** The test files a change touches: changed, deleted, or weakened by a skip marker or lost assertions. */
async function testFacts(kit: Kit, root: string, from: string, branch: string, files: string[]): Promise<string[]> {
  const kinds = fileKinds(kit);
  const range = `${from}..${branch}`;
  const isTest = (path: string) => kindOf(path, kinds) === "test";
  const tests = files.filter(isTest);
  const deleted = (await changedFiles(root, range, "D"))?.filter(isTest);
  const modified = (await changedFiles(root, range, "M"))?.filter(isTest);
  const weaker: string[] = [];
  for (const path of modified ?? []) {
    const [before, after] = await Promise.all(
      [from, branch].map(async (ref) => (await git(root, ["show", `${ref}:${path}`])).stdout),
    );
    const how = weakened(before!, after!, testMarkers(kit));
    if (how) weaker.push(`${path}: ${how}.`);
  }
  return [
    ...(tests.length > 0 ? [`Tests changed: ${tests.join(", ")}.`] : []),
    ...(deleted
      ? deleted.map((path) => `${path} is deleted.`)
      : ["Which test files it deleted could not be read from git."]),
    ...(modified ? weaker : ["Which test files it weakened could not be read from git."]),
  ];
}

function recordFacts(project: Project, ledger: Ledger, lane: Lane): string[] {
  const tasks = tasksOf(ledger, lane.id);
  const open = Object.values(loadIncidents(project.state).items).filter(
    (incident) => incident.open && incident.lane === lane.id,
  );
  return [
    ...tasks
      .filter((task) => task.status === "merged" && task.handback?.gate?.ok === false)
      .map((task) => `${task.id} was accepted over its red gate: ${task.handback!.gate!.note}.`),
    ...tasks.filter(unfinished).map((task) => `${task.id} is ${task.status}: landing cuts it.`),
    ...open.map((incident) => `Incident ${incident.id} on this lane is still open: ${incident.kind}.`),
    ...tasks
      .filter((task) => task.kind === "review" && task.handback)
      .map((task) => `${task.id} review: ${task.handback!.outcome}.`),
    ...reviewFacts(ledger, lane),
  ];
}
