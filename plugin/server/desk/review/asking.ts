import { recordEvent } from "../store/event-log.ts";
import type { CheckSpec } from "../../catalog/kit/kit.ts";
import { errorText } from "../../core/errors.ts";
import { daemonLog } from "../../core/logger.ts";
import type { Answer, Judge, Question } from "../../core/ports.ts";
import type { Project } from "../project/project.ts";
import { appendRecord } from "../store/records.ts";
import type { DeskServices } from "../services.ts";

/**
 * One moment of the record review asks about, as evidence for whoever accepts the work: whose it is (`subject`), which of theirs (`episode`), the state the
 * questions read, and each question by the name it is asked under, with the check it comes from and the fields the code fills.
 */
export type Case = {
  subject: string;
  episode: string;
  state: Record<string, unknown>;
  asked: Record<string, { check: string; fill?: Record<string, string> }>;
};

/** The sensor that asks review's checks for `project`, or why none can: no sensor, no key, or a host with no way to ask. */
function judgeFor(
  { teamFor, sensorFor }: Pick<DeskServices, "teamFor" | "sensorFor">,
  project: Project,
): { id: string; judge: Judge } | { id: string; unasked: string } {
  const { sensor } = teamFor(project).review;
  if (!sensor) return { id: "", unasked: "no sensor the kit knows is set to ask review's checks" };
  if (!sensor.key)
    return { id: sensor.id, unasked: `${sensor.sensor.label} has no ${sensor.sensor.key} on this machine` };
  const judge = sensorFor(sensor.sensor, sensor.key);
  return judge ? { id: sensor.id, judge } : { id: sensor.id, unasked: "this host has no way to ask a sensor" };
}

/** The check's wording with the fields the code fills; one left unfilled is the code's mistake, and nothing is asked. */
function questionOf(check: CheckSpec, fill: Record<string, string> = {}): Question {
  const { instructions } = check;
  if (typeof instructions === "string") return { type: check.type, instructions, criteria: check.criteria };
  const filled = Object.fromEntries(
    Object.entries(instructions).map(([field, value]) => [field, value ?? fill[field]]),
  );
  const missing = Object.keys(filled).filter((field) => filled[field] === undefined);
  if (missing.length > 0) throw new Error(`nothing filled ${missing.join(", ")} in ${JSON.stringify(instructions)}`);
  return { type: check.type, instructions: filled as Record<string, string>, criteria: check.criteria };
}

/** Where an answer falls: a noul on its check's thresholds, a choice as picked where it is sure enough. */
function verdictOf(check: CheckSpec, answer: Answer): string {
  if (check.type === "choice") return "choice" in answer && answer.confidence >= check.sure ? answer.choice : "unclear";
  const yes = "noul" in answer ? answer.noul : undefined;
  return yes === undefined ? "unclear" : yes >= check.yes ? "yes" : yes <= check.no ? "no" : "unclear";
}

/**
 * Asks review's sensor about one case, and keeps what came back, or why nothing could be asked: in shadow that record is all
 * an answer does. Nothing the desk does waits on it, so it never throws.
 */
export async function judge(
  services: Pick<DeskServices, "kit" | "teamFor" | "sensorFor">,
  project: Project,
  found: Case,
): Promise<void> {
  try {
    await ask(services, project, found);
  } catch (error) {
    daemonLog.error(`${project.slug}: review's evidence could not be asked about ${found.subject}:`, error);
  }
}

async function ask(
  services: Pick<DeskServices, "kit" | "teamFor" | "sensorFor">,
  project: Project,
  found: Case,
): Promise<void> {
  const { kit } = services;
  const asked = Object.entries(found.asked).filter(([, { check }]) => kit.checks[check]?.mode === "shadow");
  if (asked.length === 0) return;
  const chosen = judgeFor(services, project);
  const kept = {
    at: new Date().toISOString(),
    subject: found.subject,
    episode: found.episode,
    by: chosen.id,
    state: found.state,
    checks: Object.fromEntries(asked.map(([name, { check }]) => [name, check])),
  };
  if ("unasked" in chosen) return unasked(project, kept, chosen.unasked);
  const { judge } = chosen;
  try {
    const questions = Object.fromEntries(
      asked.map(([name, { check, fill }]) => [name, questionOf(kit.checks[check]!, fill)]),
    );
    const judged = await judge.ask(found.state, questions);
    const verdicts = Object.fromEntries(
      asked.map(([name, { check }]) => [name, verdictOf(kit.checks[check]!, judged.answers[name]!)]),
    );
    appendRecord(
      project.state,
      "assessments",
      `${JSON.stringify({ ...kept, questions, model: judged.model, tokens: judged.tokens, answers: judged.answers, why: judged.why, verdicts })}\n`,
    );
  } catch (error) {
    unasked(project, kept, errorText(error));
  }
}

function unasked(project: Project, kept: { subject: string; by: string }, why: string): void {
  appendRecord(project.state, "assessments", `${JSON.stringify({ ...kept, unasked: why })}\n`);
  recordEvent(project, { kind: "review.unasked", subject: kept.subject, by: kept.by, error: why });
}
