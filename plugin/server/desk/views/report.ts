import type { Kit } from "../../catalog/kit/kit.ts";
import { DAY_MS, minutesSince } from "../../core/time.ts";
import type { Question } from "../../domain/question.ts";
import type { ReportItem, ReportView } from "../../../shared/views.ts";
import { askedSince } from "../human/questions.ts";
import type { Incident } from "../../domain/incident.ts";
import { loadIncidents } from "../store/incidents.ts";
import { loadLedger } from "../store/ledger.ts";
import type { Project } from "../project/project.ts";
import { type DatedEvent, eventsSince } from "./events-since.ts";
import { decidedFor } from "./report-decided.ts";
import { recheckNumbers } from "./report-rechecks.ts";
import { type Seated, needsOf, stops } from "./report-needs.ts";

/** `from` is when the Human last marked the Report read, none before they ever have; `human` whether they are in the loop. */
type ReportInputs = { kit: Kit; questionsPerDay: number; human: boolean; from: number | null; seated: Seated };

/** What happened in a project since the Human last marked it read, built from its record by the desk, not written by an agent. */
export function reportView(project: Project, inputs: ReportInputs, now = Date.now()): ReportView {
  const { kit, from, human, seated } = inputs;
  const ledger = loadLedger(project.state);
  const since = from ?? 0;
  const events = eventsSince(project.state, since);
  const questions = Object.values(ledger.questions);
  const open = questions.filter((question) => question.status === "open");
  const lanes = Object.values(ledger.lanes);
  const waiting = lanes.filter((lane) => lane.status === "open" && lane.landApproval && !lane.landApproval.approved);
  const landed = lanes.filter((lane) => lane.landed && (lane.closedAt ?? 0) >= since);
  const incidents = Object.values(loadIncidents(project.state).items).filter((incident) => incident.opened >= since);
  const asked = (question: Question): ReportItem => ({
    title: `${question.id} · ${question.question}`,
    detail: `${question.class}${question.lane ? ` · ${question.lane}` : ""}`,
    minutes: minutesSince(now, question.openedAt),
  });
  return {
    window: { from, until: now },
    needs: needsOf(kit, project, ledger, seated, human, now),
    decided: decidedFor(kit, ledger, events, now),
    ahead: open
      .filter((question) => !stops(question))
      .map((question) => ({ ...asked(question), detail: `${question.class} · went ahead on ${question.recommend}` })),
    landed: landed.map((lane) => ({
      title: `${lane.id} ${lane.title}`,
      detail: `on ${lane.base}`,
      minutes: minutesSince(now, lane.closedAt!),
    })),
    withdrawn: questions
      .filter((question) => question.answer?.by === "supervisor" && question.answer.at >= since)
      .map((question) => ({
        ...asked(question),
        detail: `withdrawn by the Supervisor: ${question.answer!.text ?? "no reason given"}`,
        minutes: minutesSince(now, question.answer!.at),
      })),
    chat: questions
      .filter((question) => question.answer?.by === "chat" && question.answer.at >= since)
      .map((question) => ({
        ...asked(question),
        detail: `${question.answer!.choice}, put on record from their words: ${question.answer!.quote?.replace(/\s+/g, " ") ?? ""}`,
        minutes: minutesSince(now, question.answer!.at),
      })),
    beyond: incidents
      .filter((incident) => incident.level === "page")
      .map((incident) => ({
        title: `${incident.id} · ${incident.quote}`,
        detail: [incident.where, incident.label ? `marked ${incident.label}` : "not marked"].join(" · "),
        minutes: minutesSince(now, incident.opened),
      })),
    numbers: [
      ...numbers(project, inputs.questionsPerDay, now - DAY_MS, landed.length, waiting.length, incidents),
      answerNumbers(questions, events, since),
      recheckNumbers(kit, ledger, since),
    ],
  };
}

/** Questions asked in the last day against the allowance; the window's landings, and its incidents by how they were marked. */
function numbers(
  project: Project,
  perDay: number,
  dayAgo: number,
  landed: number,
  waiting: number,
  incidents: Incident[],
): ReportView["numbers"] {
  const marked = ["useful", "noise", "unknown"].map(
    (label) => `${incidents.filter((incident) => incident.label === label).length} ${label}`,
  );
  return [
    {
      title: "Questions today",
      value: `${askedSince(project.state, dayAgo).length} of ${perDay}`,
      detail: "across every project",
    },
    {
      title: "Landings",
      value: `${landed} landed`,
      detail: waiting > 0 ? `${waiting} waiting for you` : "none waiting for you",
    },
    {
      title: "Incidents",
      value: `${incidents.length}`,
      detail: marked.concat(`${incidents.filter((incident) => !incident.label).length} not marked`).join(" · "),
    },
  ];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

/** How often the Human's answer was the one recommended, and how fast they answered and approved: a check on waving things through. */
function answerNumbers(questions: Question[], events: DatedEvent[], since: number): ReportView["numbers"][number] {
  const answered = questions.filter(
    (question) =>
      question.status === "answered" &&
      (question.answer?.by === "panel" || question.answer?.by === "chat") &&
      question.answer.at >= since,
  );
  const took = answered.filter((question) => question.answer!.choice === question.recommend).length;
  const held = new Map<string, number>();
  const approvals: number[] = [];
  for (const event of events)
    if (event.kind === "land.held") held.set(event.lane, Date.parse(event.at));
    else if (event.kind === "land.approved" && held.has(event.lane))
      approvals.push(Date.parse(event.at) - held.get(event.lane)!);
  const minutesOf = (spans: number[]) => Math.round(median(spans) / 60_000);
  const detail = [
    ...(answered.length > 0
      ? [`median ${minutesOf(answered.map((question) => question.answer!.at - question.openedAt))} min to answer`]
      : []),
    ...(approvals.length > 0 ? [`landings approved in a median ${minutesOf(approvals)} min`] : []),
  ];
  return {
    title: "Your answers",
    value: answered.length > 0 ? `${took} of ${answered.length} took the recommendation` : "none yet",
    detail: detail.length > 0 ? detail.join(" · ") : "No question answered and no landing approved in this window.",
  };
}
