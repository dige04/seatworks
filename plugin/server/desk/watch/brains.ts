import type { PatternSpec } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { Judge, Question } from "../../core/ports.ts";
import { clip } from "../../core/text.ts";
import type { Finding } from "../../domain/incident.ts";
import { type Ledger, tasksOf } from "../../domain/ledger.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { type Assessments, askKept, holds } from "../store/assessments.ts";
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

/** What the seat's work asks of it, which a judgement that leaves it out gets wrong. */
function askedOf(place: Placed): Record<string, unknown> {
  const { task, lane } = place;
  if (task) return { goal: task.goal, acceptance: task.acceptance, out_of_scope: task.outOfScope };
  if (lane) return { goal: lane.outcome, acceptance: lane.acceptance, out_of_scope: lane.outOfScope };
  return {};
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

const asQuestion = (pattern: PatternSpec, instructions: string): Question => ({
  type: "condition",
  instructions,
  criteria: pattern.criteria,
});

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
    const questions = Object.fromEntries(mine.map(([id, pattern]) => [id, asQuestion(pattern, pattern.instructions!)]));
    const state = { text: item.text, ...asked };
    const judged = await askKept(project, WATCH, { subject, episode: "look", by: by.id, state }, judge, questions);
    if (!judged) continue;
    for (const [id, pattern] of mine) {
      const answer = judged.answers[id];
      const verdict = holds(pattern, answer);
      if (verdict !== "no") flagged.add(id);
      if (verdict === "yes" && pattern.level !== "note")
        found.push({
          ...finding(
            id,
            item.text,
            quote,
            `seen by ${by.sensor.label}, ${(answer as { likely: number }).likely.toFixed(2)} sure, in its ${item.kind}`,
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
  const questions = Object.fromEntries(patterns.map(([id, pattern]) => [id, asQuestion(pattern, pattern.seat)]));
  const judged = await askKept(project, WATCH, { subject, episode: "look", by, state }, judge, questions);
  if (!judged) return [];
  return patterns.flatMap(([id, pattern]) =>
    holds(pattern, judged.answers[id]) === "yes" && pattern.level !== "note"
      ? [finding(id, judged.why?.[id] ?? "", cut.quote, "judged by the Watcher seat")]
      : [],
  );
}

const finding = (kind: string, quote: string, limit: number, seen: string): Finding => ({
  kind,
  level: "attend",
  quote: clip(quote.replace(/\s+/g, " ").trim(), limit),
  facts: [kind, seen],
  brain: true,
});
