import type { PatternSpec } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { Judge, Question } from "../../core/ports.ts";
import { clip } from "../../core/text.ts";
import type { Finding } from "../../domain/incident.ts";
import { tasksOf } from "../../domain/ledger.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { loadLedger } from "../store/ledger.ts";
import { type Assessments, askKept, holds } from "../store/assessments.ts";
import { type Noticed, type Placed, notice, placeOf } from "./notice.ts";

/** One of a seat's own words a look read: its thinking, what it said, or a brief it wrote. */
type Item = { kind: "thought" | "said" | "brief"; text: string };

/** What one look read of a seat, as the brains take it: its words since `since`, the code's facts meanwhile, its instruction. */
export type Look = {
  items: { kind: "thought" | "said"; text: string }[];
  facts: string[];
  since: number;
  instruction?: { text: string; from: string[] };
};

const WATCH: Assessments = { log: "assessments", unasked: "watch.unasked" };

const ITEM = 1500;
const QUOTE = 400;

type Pattern = [string, PatternSpec];

/**
 * The brains read what one look saw of a seat against the patterns that watch it. The sensor asks each item its patterns'
 * one-condition questions; the seat judges the whole look. In `both` the seat hears only what the sensor flagged or left
 * unsure, and what only it can judge. What they find goes to the incident book, which keeps each in shadow until its
 * signal is on; every answer is kept for labels.
 */
export async function readLook(services: DeskServices, project: Project, seat: Noticed, look: Look): Promise<void> {
  const { kit, teamFor } = services;
  const { brains } = teamFor(project);
  const role = seatOf(kit, seat.provider)?.role;
  if (brains.mode === "off" || !role) return;
  const place = placeOf(project, seat);
  const items = [...look.items, ...briefsSince(project, seat, place, look.since)].map((item) => ({
    ...item,
    text: clip(item.text, ITEM),
  }));
  if (items.length === 0) return;
  const signs = new Set([
    ...look.facts,
    ...(place.task?.reworks ? ["reworked"] : []),
    ...(place.task?.handback ? ["handed-back"] : []),
  ]);
  const read = new Set(items.map((item) => item.kind));
  const patterns = Object.entries(kit.patterns).filter(
    ([, pattern]) =>
      pattern.watches.some((capability) => can(role, capability)) &&
      pattern.reads.some((kind) => read.has(kind)) &&
      (!pattern.gate || pattern.gate.some((sign) => signs.has(sign))),
  );
  if (patterns.length === 0) return;
  const asked = askedOf(place);
  const subject = place.task?.id ?? place.lane?.id ?? seat.id;
  const findings: Finding[] = [];
  const sensor = brains.sensor?.key ? services.sensorFor(brains.sensor.sensor, brains.sensor.key) : undefined;
  const sifted =
    sensor && brains.sensor ? await sift(project, subject, brains.sensor, sensor, items, patterns, asked) : undefined;
  if (sifted && brains.mode === "sensor") findings.push(...sifted.found);
  if (brains.seat && brains.mode !== "sensor") {
    // In both, the seat judges what the sensor flagged or left unsure; with no sensor to sift, it judges it all.
    const judged =
      sifted && brains.mode === "both"
        ? patterns.filter(([id, pattern]) => sifted.flagged.has(id) || !pattern.instructions)
        : patterns;
    if (judged.length > 0) {
      const judge = services.watcher.judge(project, brains.seat.role, subject);
      findings.push(...(await weigh(project, subject, brains.seat.id, judge, place, items, judged, asked, look)));
    }
  }
  if (findings.length > 0) await notice(services, project, seat, findings);
}

/** What the seat's work asks of it, which a judgement that leaves it out gets wrong. */
function askedOf(place: Placed): Record<string, unknown> {
  const { task, lane } = place;
  if (task) return { goal: task.goal, acceptance: task.acceptance, out_of_scope: task.outOfScope };
  if (lane) return { goal: lane.outcome, acceptance: lane.acceptance, out_of_scope: lane.outOfScope };
  return {};
}

/** The briefs a Lead wrote since its last look: the tasks it laid out, each as its Peer reads what it is asked. */
function briefsSince(project: Project, seat: Noticed, place: Placed, since: number): Item[] {
  if (!place.lane || place.task || place.lane.lead !== seat.id) return [];
  try {
    return tasksOf(loadLedger(project.state), place.lane.id)
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
  } catch {
    return [];
  }
}

/** A question as a brain is asked it: the sensor on one item's `text`, the seat on the whole look. */
const asQuestion = (pattern: PatternSpec, instructions: string): Question => ({
  type: "noul",
  instructions,
  criteria: pattern.criteria,
});

/** Each item asked what its patterns ask of it; a yes is found, and a yes or an unsure answer is flagged for the seat. */
async function sift(
  project: Project,
  subject: string,
  by: { id: string; sensor: { label: string } },
  judge: Judge,
  items: Item[],
  patterns: Pattern[],
  asked: Record<string, unknown>,
): Promise<{ found: Finding[]; flagged: Set<string> }> {
  const found: Finding[] = [];
  const flagged = new Set<string>();
  for (const item of items) {
    const mine = patterns.filter(([, pattern]) => pattern.instructions && pattern.reads.includes(item.kind));
    if (mine.length === 0) continue;
    const questions = Object.fromEntries(mine.map(([id, pattern]) => [id, asQuestion(pattern, pattern.instructions!)]));
    const state = { text: item.text, ...asked };
    const judged = await askKept(project, WATCH, { subject, episode: "look", by: by.id, state }, judge, questions);
    if (!judged) continue;
    for (const [id, pattern] of mine) {
      const answer = judged.answers[id];
      const verdict = holds(pattern, answer);
      if (verdict !== "no") flagged.add(id);
      if (verdict === "yes")
        found.push({
          ...finding(
            id,
            item.text,
            `seen by ${by.sensor.label}, ${(answer as { noul: number }).noul.toFixed(2)} sure, in its ${item.kind}`,
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
): Promise<Finding[]> {
  const state = {
    seat: place.where,
    ...asked,
    ...(look.instruction ? { instruction: clip(look.instruction.text, ITEM) } : {}),
    items: items.map((item) => `[${item.kind}] ${item.text}`),
    ...(look.facts.length > 0 ? { facts: look.facts } : {}),
  };
  const questions = Object.fromEntries(patterns.map(([id, pattern]) => [id, asQuestion(pattern, pattern.seat)]));
  const judged = await askKept(project, WATCH, { subject, episode: "look", by, state }, judge, questions);
  if (!judged) return [];
  return patterns.flatMap(([id, pattern]) =>
    holds(pattern, judged.answers[id]) === "yes"
      ? [finding(id, judged.why?.[id] ?? "", "judged by the Watcher seat")]
      : [],
  );
}

const finding = (kind: string, quote: string, seen: string): Finding => ({
  kind,
  level: "attend",
  quote: clip(quote.replace(/\s+/g, " ").trim(), QUOTE),
  facts: [kind, seen],
});
