import { readFileSync } from "node:fs";
import type { PatternSpec } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { Judge, Judgement, Question } from "../../core/ports.ts";
import { clip } from "../../core/text.ts";
import type { Finding } from "../../domain/incident.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, tasksOf } from "../../domain/ledger.ts";
import { type Project, conceptFile } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { type Assessments, askKept, holds } from "../store/assessments.ts";
import { list } from "../letters/envelope.ts";
import { type Noticed, type Placed, ledgerOf, notice, placeIn } from "./notice.ts";

type Item = { kind: "thought" | "said" | "brief"; text: string };

/** What one look read of a seat, as the brains take it: its words since `since`, the code's facts meanwhile, its instruction. */
export type Look = {
  items: { kind: "thought" | "said"; text: string }[];
  facts: string[];
  since: number;
  instruction?: { text: string; from: string[] };
};

const WATCH: Assessments = { log: "assessments", unasked: "watch.unasked" };

type Pattern = [string, PatternSpec];

/**
 * The brains read what one look saw of a seat against the patterns that watch it. The sensor asks each item its patterns'
 * one-condition questions; the seat judges the whole look. In `both` the seat hears only what the sensor flagged or left
 * unsure, and what only it can judge. What they find goes to the incident book, which tells whoever supervises; every
 * answer is kept for labels.
 */
export async function readLook(
  services: Pick<DeskServices, "kit" | "incidents" | "teamFor" | "mail" | "roster" | "sensorFor" | "watcher">,
  project: Project,
  seat: Noticed,
  look: Look,
): Promise<void> {
  const { kit, teamFor } = services;
  const { brains, attention } = teamFor(project);
  const cut = { item: attention.lookItemChars, quote: attention.quoteChars };
  const role = seatOf(kit, seat.provider)?.role;
  if (brains.mode === "off" || !role) return;
  const ledger = ledgerOf(project);
  const place = placeIn(kit, ledger, seat);
  const items = [...look.items, ...briefsSince(ledger, seat, place, look.since)].map((item) => ({
    ...item,
    text: clip(item.text, cut.item),
  }));
  if (items.length === 0) return;
  const signs = signsOf(look, place);
  const read = new Set(items.map((item) => item.kind));
  const patterns = Object.entries(kit.patterns).filter(
    ([, pattern]) =>
      pattern.watches.some((capability) => can(role, capability)) &&
      pattern.reads.some((kind) => read.has(kind)) &&
      (!pattern.gate || pattern.gate.some((sign) => signs.has(sign))) &&
      !pattern.except?.some((sign) => signs.has(sign)),
  );
  if (patterns.length === 0) return;
  const asked = askedOf(place, conceptOf(project, attention.conceptChars));
  const subject = place.task?.id ?? place.lane?.id ?? seat.id;
  const findings: Finding[] = [];
  const sensor = brains.sensor?.key ? services.sensorFor(brains.sensor.sensor, brains.sensor.key) : undefined;
  const sifted =
    sensor && brains.sensor
      ? await sift(project, subject, brains.sensor, sensor, items, patterns, asked, cut.quote)
      : undefined;
  if (sifted && brains.mode === "sensor") findings.push(...sifted.found);
  if (brains.seat && brains.mode !== "sensor") {
    const judged =
      sifted && brains.mode === "both"
        ? patterns.filter(([id, pattern]) => sifted.flagged.has(id) || !pattern.instructions)
        : patterns;
    if (judged.length > 0) {
      const judge = services.watcher.judge(project, brains.seat, subject);
      findings.push(...(await weigh(project, subject, brains.seat, judge, place, items, judged, asked, look, cut)));
    }
  }
  if (findings.length > 0) await notice(services, project, seat, findings, place);
}

/**
 * What the look knows of the seat's work besides its words. A task is `reworking` while sent back, and in the look that
 * reads the hand-back answering it, since a Peer hands back just before its turn ends.
 */
function signsOf(look: Look, { task }: Placed): Set<string> {
  const answering = task?.handback && task.handback.reworks > 0 && task.handback.at >= look.since;
  return new Set([
    ...look.facts,
    ...(task?.reworks ? ["reworked"] : []),
    ...(task?.status === "rework" || answering ? ["reworking"] : []),
    ...(task?.handback ? ["handed-back"] : []),
  ]);
}

/**
 * What the seat's work asks of it, which a judgement that leaves it out gets wrong, and what it last handed back. A Lead
 * also has its lane's directive whole, and the Human's settled words, which is what a pattern's excuse is read against.
 */
function askedOf(place: Placed, concept: string | undefined): Record<string, unknown> {
  const { task, lane } = place;
  if (task)
    return {
      goal: task.goal,
      acceptance: task.acceptance,
      out_of_scope: task.outOfScope,
      ...(task.handback ? { handback: task.handback.summary } : {}),
    };
  if (lane)
    return {
      goal: lane.outcome,
      acceptance: lane.acceptance,
      out_of_scope: lane.outOfScope,
      directive: directiveOf(lane),
      ...(concept ? { context: concept } : {}),
    };
  return {};
}

function directiveOf(lane: Lane): string {
  return [
    `Outcome: ${lane.outcome}`,
    ...(lane.humanSaid ? [`The Human's own words it comes from: "${lane.humanSaid}"`] : []),
    "Acceptance:",
    list(lane.acceptance),
    ...(lane.writeSet.length > 0 ? [`Writes: ${lane.writeSet.join(", ")}`] : []),
    ...(lane.contracts.length > 0 ? [`Depends on: ${lane.contracts.join(", ")}`] : []),
  ].join("\n");
}

/** The project's concept file cut to `limit`, or none when there is none or it cannot be read. */
function conceptOf(project: Project, limit: number): string | undefined {
  const file = conceptFile(project.state);
  try {
    return file ? clip(readFileSync(file, "utf-8").trim(), limit) || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** The briefs a Lead wrote since its last look: the tasks it laid out, each as its Peer reads what it is asked. */
function briefsSince(ledger: Ledger | undefined, seat: Noticed, place: Placed, since: number): Item[] {
  if (!ledger || !place.lane || place.task || place.lane.lead !== seat.id) return [];
  return tasksOf(ledger, place.lane.id)
    .filter((task) => task.kind === "code" && task.openedAt >= since)
    .map((task) => ({
      kind: "brief" as const,
      text: [
        `${task.id}: ${task.goal}`,
        task.context ?? "",
        task.hints.length > 0 ? `Hints: ${task.hints.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    }));
}

const asQuestion = (spec: { criteria: PatternSpec["criteria"] }, instructions: string): Question => ({
  type: "condition",
  instructions,
  criteria: spec.criteria,
});

/** The name a pattern's excuse is asked under, beside the pattern's own question. */
const excuseOf = (id: string) => `${id}-excused`;

type Words = (spec: { instructions?: string; seat: string }) => string | undefined;

/**
 * Each pattern's question in `words`, the sensor's or the seat's, and its excuse where every field the excuse names is in
 * `state`: an excuse about a field the case lacks cannot excuse anything.
 */
function questionsOf(patterns: Pattern[], words: Words, state: Record<string, unknown>): Record<string, Question> {
  const has = (question: string) =>
    [...question.matchAll(/`(\w+)`/g)].every(([, field]) => field === "text" || Object.hasOwn(state, field!));
  return Object.fromEntries(
    patterns.flatMap(([id, pattern]) => {
      const own = words(pattern);
      if (!own) return [];
      const asked: [string, Question][] = [[id, asQuestion(pattern, own)]];
      const excuse = pattern.excusedIf && words(pattern.excusedIf);
      if (excuse && has(excuse)) asked.push([excuseOf(id), asQuestion(pattern.excusedIf!, excuse)]);
      return asked;
    }),
  );
}

/** A pattern holds when its question does and its excuse, if it was asked, does not: one condition each, the code combines. */
function verdictOf(
  [id, pattern]: Pattern,
  questions: Record<string, Question>,
  answers: Judgement["answers"],
): "yes" | "no" | "unclear" {
  const own = holds(pattern, answers[id]);
  if (!Object.hasOwn(questions, excuseOf(id))) return own;
  const excused = holds(pattern, answers[excuseOf(id)]);
  if (own === "no" || excused === "yes") return "no";
  return own === "yes" && excused === "no" ? "yes" : "unclear";
}

async function sift(
  project: Project,
  subject: string,
  by: { id: string; sensor: { label: string } },
  judge: Judge,
  items: Item[],
  patterns: Pattern[],
  asked: Record<string, unknown>,
  quote: number,
): Promise<{ found: Finding[]; flagged: Set<string> }> {
  const found: Finding[] = [];
  const flagged = new Set<string>();
  for (const item of items) {
    const mine = patterns.filter(([, pattern]) => pattern.instructions && pattern.reads.includes(item.kind));
    if (mine.length === 0) continue;
    const state = { text: item.text, ...asked };
    const questions = questionsOf(mine, (spec) => spec.instructions, state);
    const judged = await askKept(project, WATCH, { subject, episode: "look", by: by.id, state }, judge, questions);
    if (!judged) continue;
    for (const entry of mine) {
      const [id, pattern] = entry;
      const verdict = verdictOf(entry, questions, judged.answers);
      if (verdict !== "no") flagged.add(id);
      if (verdict === "yes" && pattern.level !== "note")
        found.push({
          ...finding(
            id,
            item.text,
            quote,
            `seen by ${by.sensor.label}, ${(judged.answers[id] as { likely: number }).likely.toFixed(2)} sure, in its ${item.kind}`,
          ),
          theirs: true,
        });
    }
  }
  return { found, flagged };
}

/** The whole look judged by the seat against `patterns`: a yes is found, in the words its why quotes. */
async function weigh(
  project: Project,
  subject: string,
  by: string,
  judge: Judge,
  place: Placed,
  items: Item[],
  patterns: Pattern[],
  asked: Record<string, unknown>,
  look: Look,
  cut: { item: number; quote: number },
): Promise<Finding[]> {
  const state = {
    seat: place.where,
    ...asked,
    ...(look.instruction ? { instruction: clip(look.instruction.text, cut.item) } : {}),
    items: items.map((item) => `[${item.kind}] ${item.text}`),
    ...(look.facts.length > 0 ? { facts: look.facts } : {}),
  };
  const questions = questionsOf(patterns, (spec) => spec.seat, state);
  const judged = await askKept(project, WATCH, { subject, episode: "look", by, state }, judge, questions);
  if (!judged) return [];
  return patterns.flatMap((entry) => {
    const [id, pattern] = entry;
    return verdictOf(entry, questions, judged.answers) === "yes" && pattern.level !== "note"
      ? [finding(id, judged.why?.[id] ?? "", cut.quote, "judged by the Watcher seat")]
      : [];
  });
}

const finding = (kind: string, quote: string, limit: number, seen: string): Finding => ({
  kind,
  level: "attend",
  quote: clip(quote.replace(/\s+/g, " ").trim(), limit),
  facts: [kind, seen],
  brain: true,
});
