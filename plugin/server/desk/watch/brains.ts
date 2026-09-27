import { readFileSync } from "node:fs";
import type { PatternSpec } from "../../catalog/kit/kit.ts";
import { recordPatterns } from "../../catalog/kit/ecosystem-patterns.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { Judge, Judgement, Question } from "../../core/ports.ts";
import { clip } from "../../core/text.ts";
import type { Finding } from "../../domain/incident.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Project, conceptFile } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { type Assessments, askKept, holds } from "../store/assessments.ts";
import { list } from "../letters/envelope.ts";
import type { Item } from "./decisions.ts";
import { type Noticed, type Placed, ledgerOf, notice, placeIn } from "./notice.ts";
import type { About, Kept } from "./watcher.ts";

/** What one look read of a seat, as the brains take it: its words since `since`, the code's facts meanwhile, its instruction. */
export type Look = {
  items: { kind: "thought" | "said"; text: string }[];
  facts: string[];
  since: number;
  instruction?: { text: string; from: string[] };
};

const WATCH: Assessments = { log: "assessments", unasked: "watch.unasked" };

type Pattern = [string, PatternSpec];

type Services = Pick<
  DeskServices,
  "kit" | "incidents" | "teamFor" | "mail" | "roster" | "sensorFor" | "watcher" | "decisions"
>;

/** One case for the brains: what it is about, the items it reads, the patterns asked of them, and the fields beside them. */
type Case = { episode: string; items: Item[]; patterns: Pattern[]; fields: Record<string, unknown> };

/**
 * The brains read a seat's words against the patterns that watch it: the words of each look against the patterns judged
 * in looks, and each decision it made through the desk, the call with the words that led to it, against the patterns
 * judged at that call. The sensor asks each item its patterns' one-condition questions; the seat judges the whole case.
 * In `both` the seat hears only what the sensor flagged or left unsure, and what only it can judge. What they find goes
 * to the incident book, which tells whoever supervises; every answer is kept for labels.
 */
export async function readLook(services: Services, project: Project, seat: Noticed, look: Look): Promise<void> {
  const { kit, teamFor } = services;
  const { brains, attention } = teamFor(project);
  const words = look.items.map((item) => ({ ...item, text: clip(item.text, attention.lookItemChars) }));
  const decided = services.decisions.take(seat.id, words, attention.decisionChars);
  const role = seatOf(kit, seat.provider)?.role;
  if (brains.mode === "off" || !role || (words.length === 0 && !decided)) return;
  const place = placeIn(kit, ledgerOf(project), seat);
  const signs = [
    ...look.facts,
    ...(place.task?.reworks ? ["reworked"] : []),
    ...(place.task?.handback ? ["handed-back"] : []),
  ];
  const certainty = recordPatterns(kit).certainty;
  const watching = (items: Item[], judged: (pattern: PatternSpec) => boolean): Pattern[] => {
    const read = new Set(items.map((item) => item.kind));
    const known = new Set([
      ...signs,
      ...(items.some((item) => item.kind === "call" && certainty.test(item.text)) ? ["certainty-only"] : []),
    ]);
    return Object.entries(kit.patterns).filter(
      ([, pattern]) =>
        judged(pattern) &&
        pattern.watches.some((capability) => can(role, capability)) &&
        pattern.reads.some((kind) => read.has(kind)) &&
        (!pattern.gate || pattern.gate.some((sign) => known.has(sign))),
    );
  };
  const instruction = look.instruction ? { instruction: clip(look.instruction.text, attention.lookItemChars) } : {};
  const cases: Case[] = [
    { episode: "look", items: words, patterns: watching(words, (pattern) => !pattern.tools), fields: instruction },
    ...(decided?.calls ?? []).map((call) => {
      const items: Item[] = [...decided!.words, { kind: "call", text: clip(call.text, attention.decisionChars) }];
      const patterns = watching(items, (pattern) => pattern.tools?.includes(call.tool) === true);
      return { episode: call.tool, items, patterns, fields: { ...instruction, call: call.tool } };
    }),
  ];
  const asked = askedOf(place, conceptOf(project, attention.conceptChars));
  const subject = place.task?.id ?? place.lane?.id ?? seat.id;
  // Each case on its own, so a decision is not held behind the look before it.
  const judged = cases
    .filter((each) => each.patterns.length > 0)
    .map((one) => judgeCase(services, project, { seat, subject }, place, { ...one, facts: look.facts }, asked));
  const findings = (await Promise.all(judged)).flat();
  if (findings.length > 0) await notice(services, project, seat, findings, place);
}

async function judgeCase(
  services: Services,
  project: Project,
  { seat, subject }: Omit<About, "episode">,
  place: Placed,
  one: Case & { facts: string[] },
  asked: Record<string, unknown>,
): Promise<Finding[]> {
  const { brains, attention } = services.teamFor(project);
  const sensor = brains.sensor?.key ? services.sensorFor(brains.sensor.sensor, brains.sensor.key) : undefined;
  const about = { subject, episode: one.episode };
  const sifted =
    sensor && brains.sensor
      ? await sift(project, about, brains.sensor, sensor, one.items, one.patterns, asked, attention.quoteChars)
      : undefined;
  if (brains.mode === "sensor") return sifted?.found ?? [];
  if (!brains.seat) return [];
  const judged =
    sifted && brains.mode === "both"
      ? one.patterns.filter(([id, pattern]) => sifted.flagged.has(id) || !pattern.instructions)
      : one.patterns;
  if (judged.length === 0) return [];
  const state = {
    seat: place.where,
    ...asked,
    ...one.fields,
    items: one.items.map((item) => `[${item.kind}] ${item.text}`),
    ...(one.facts.length > 0 ? { facts: one.facts } : {}),
  };
  const judge = services.watcher.judge(project, brains.seat, { seat, ...about });
  return weigh(project, about, brains.seat, judge, state, judged, attention.quoteChars);
}

/**
 * What the seat's work asks of it, which a judgement that leaves it out gets wrong, and what it last handed back. A Lead
 * also has its lane's directive whole, and the Human's settled words.
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

const asQuestion = (pattern: PatternSpec, instructions: string): Question => ({
  type: "condition",
  instructions,
  criteria: pattern.criteria,
});

/**
 * Each item asked its patterns' one condition by the sensor; a yes on an item is found in its words. A pattern with
 * `missingFrom` holds on the words only where the call itself answers no: what the words say, the call leaves out.
 */
async function sift(
  project: Project,
  { subject, episode }: { subject: string; episode: string },
  by: { id: string; sensor: { label: string } },
  judge: Judge,
  items: Item[],
  patterns: Pattern[],
  asked: Record<string, unknown>,
  quote: number,
): Promise<{ found: Finding[]; flagged: Set<string> }> {
  const read: { id: string; item: Item; verdict: "yes" | "no" | "unclear"; likely: number }[] = [];
  for (const item of items) {
    const mine = patterns.filter(([, pattern]) => pattern.instructions && pattern.reads.includes(item.kind));
    if (mine.length === 0) continue;
    const questions = Object.fromEntries(mine.map(([id, pattern]) => [id, asQuestion(pattern, pattern.instructions!)]));
    const state = { text: item.text, ...asked };
    const judged = await askKept(project, WATCH, { subject, episode, by: by.id, state }, judge, questions);
    if (!judged) continue;
    for (const [id, pattern] of mine) {
      const answer = judged.answers[id] as { likely: number } | undefined;
      read.push({ id, item, verdict: holds(pattern, answer), likely: answer?.likely ?? 0 });
    }
  }
  const found: Finding[] = [];
  const flagged = new Set<string>();
  for (const [id, pattern] of patterns) {
    const mine = read.filter((entry) => entry.id === id);
    const against = pattern.missingFrom && mine.find((entry) => entry.item.kind === pattern.missingFrom);
    const words = against ? mine.filter((entry) => entry !== against) : mine;
    if (against?.verdict === "yes") continue;
    if (words.some((entry) => entry.verdict !== "no")) flagged.add(id);
    if (pattern.level === "note" || (against && against.verdict !== "no")) continue;
    for (const { item, verdict, likely } of words)
      if (verdict === "yes")
        found.push({
          ...finding(
            id,
            item.text,
            quote,
            `seen by ${by.sensor.label}, ${likely.toFixed(2)} sure, in its ${item.kind}`,
          ),
          theirs: true,
          ...(pattern.joins ? { joins: pattern.joins } : {}),
        });
  }
  return { found, flagged };
}

/** A case judged whole by the seat against `patterns`: a yes is found, in the words its why quotes. */
async function weigh(
  project: Project,
  { subject, episode }: { subject: string; episode: string },
  by: string,
  judge: Judge,
  state: Record<string, unknown>,
  patterns: Pattern[],
  quote: number,
): Promise<Finding[]> {
  const questions = Object.fromEntries(patterns.map(([id, pattern]) => [id, asQuestion(pattern, pattern.seat)]));
  const judged = await askKept(project, WATCH, { subject, episode, by, state }, judge, questions);
  return judged ? seatFindings(patterns, judged, quote) : [];
}

function seatFindings(patterns: Pattern[], judged: Judgement, quote: number): Finding[] {
  return patterns.flatMap(([id, pattern]) =>
    holds(pattern, judged.answers[id]) === "yes" && pattern.level !== "note"
      ? [
          {
            ...finding(id, judged.why?.[id] ?? "", quote, "judged by the Watcher seat"),
            ...(pattern.joins ? { joins: pattern.joins } : {}),
          },
        ]
      : [],
  );
}

/**
 * A case the Watcher answered, or that was given up, after a restart lost the look that asked it: kept, and booked, as
 * that look would have.
 */
export async function lateCase(
  services: Services,
  project: Project,
  kept: Kept,
  outcome: Judgement | Error,
): Promise<void> {
  const { subject, episode, seat } = kept.about;
  const judge: Judge = {
    ask: () => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)),
  };
  const about = { subject, episode, by: kept.role, state: kept.state };
  const judged = await askKept(project, WATCH, about, judge, kept.questions);
  if (!judged) return;
  const patterns = Object.entries(services.kit.patterns).filter(([id]) => Object.hasOwn(kept.questions, id));
  const findings = seatFindings(patterns, judged, services.teamFor(project).attention.quoteChars);
  if (findings.length > 0) await notice(services, project, seat, findings);
}

const finding = (kind: string, quote: string, limit: number, seen: string): Finding => ({
  kind,
  level: "attend",
  quote: clip(quote.replace(/\s+/g, " ").trim(), limit),
  facts: [kind, seen],
  brain: true,
});
