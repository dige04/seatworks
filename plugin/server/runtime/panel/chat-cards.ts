import type { Kit } from "../../catalog/kit/kit.ts";
import { errorText } from "../../core/errors.ts";
import type { ChatCard, SeatView, Seats } from "../../core/ports.ts";
import { minutesSince } from "../../core/time.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Question } from "../../domain/question.ts";
import type { Project } from "../../desk/project/project.ts";
import { readLedger } from "../../desk/store/ledger.ts";
import { landApprovalView, questionView } from "../../desk/views/flow.ts";
import { reportView } from "../../desk/views/report.ts";
import type { Seated } from "../../desk/views/report-needs.ts";
import { TIMELINE } from "../../../shared/timeline-items.ts";
import type { ReportView } from "../../../shared/views.ts";
import type { PermissionWaits } from "../permission-waits.ts";
import type { TeamSource } from "../team-source.ts";
import { seenAt } from "./report-seen.ts";

type CardsDeps = {
  kit: Kit;
  source: TeamSource;
  seats: Pick<Seats, "open" | "post">;
  waits: Pick<PermissionWaits, "heardAt">;
  supervisorFor: (project: Project) => Promise<string | undefined>;
};

/** What was posted under a card's id: to whom, what it showed, and whether it still asks the Human for something. */
type Posted = { to: string; shown: string; data: unknown; open: boolean };

/** A card's words without its clocks, so a card is posted again for what changed in it, not for the minutes going by. */
const shown = (data: unknown) =>
  JSON.stringify(data, (key, value: unknown) => (key === "minutes" || key === "until" ? undefined : value));

const card = (kind: keyof typeof TIMELINE, id: string, data: unknown): ChatCard => ({
  id,
  kind: TIMELINE[kind].kind,
  version: TIMELINE[kind].version,
  data,
});

/** How a question ended, in the words its one-line card keeps. */
function questionEnd(question: Question): string {
  const { status, answer } = question;
  if (status === "declined") return "You declined it";
  if (status === "canceled")
    return answer?.by === "supervisor"
      ? `Withdrawn: ${answer.text ?? "no reason given"}`
      : answer?.by === "panel"
        ? "You withdrew it"
        : "Its lane closed";
  return answer?.by === "chat" ? `Answered in chat: ${answer.choice}` : `You chose ${answer?.choice ?? "an option"}`;
}

/** How a held landing ended, as the ledger has the lane now. */
function landingEnd(lane: Lane): string {
  if (lane.landApproval?.approved) return "Approved: it lands now";
  if (lane.status === "closed") return lane.landed ? "Landed" : "Its lane closed";
  if (lane.onHold) return "Called off: the lane is on hold";
  return "Sent back to its Lead";
}

const hasNews = (report: ReportView) =>
  [report.needs, report.decided, report.ahead, report.landed, report.beyond, report.withdrawn, report.chat].some(
    (part) => part.length > 0,
  );

/**
 * The Human's decisions as cards in the Supervisor's chat: a question or a held landing while it waits, one line once
 * it is settled, and what happened since they last marked the report read. Each round posts only what changed, so
 * Paseo replaces a card where it stands; after a restart, whatever still waits is posted again, since Paseo forgot it.
 */
export class ChatCards {
  private readonly deps: CardsDeps;
  // One entry per project, each holding only cards still posted open or the report of this window.
  private readonly posted = new Map<string, Map<string, Posted>>();

  constructor(deps: CardsDeps) {
    this.deps = deps;
  }

  async sync(project: Project, open?: SeatView[], now = Date.now()): Promise<void> {
    const to = await this.deps.supervisorFor(project);
    if (!to) return;
    const mine = this.posted.get(project.slug) ?? new Map<string, Posted>();
    this.posted.set(project.slug, mine);
    const team = this.deps.source.teamFor(project);
    const decider = team.hitl.on
      ? undefined
      : this.deps.kit.roles.find((role) => role.can?.includes("supervise"))?.label;
    const ledger = readLedger(project.state);
    const cards: { card: ChatCard; open: boolean }[] = [];

    for (const question of Object.values(ledger.questions)) {
      const id = `${project.slug}:${question.id}`;
      if (question.status === "open")
        cards.push({
          open: true,
          card: card("question", id, {
            project: project.slug,
            question: questionView(question, now),
            settled: null,
            ...(decider ? { decider } : {}),
          }),
        });
      else if (mine.get(id)?.open)
        cards.push({
          open: false,
          card: card("question", id, {
            project: project.slug,
            question: questionView(question, now),
            settled: { text: questionEnd(question), minutes: minutesSince(now, question.answer?.at ?? now) },
          }),
        });
    }

    for (const lane of Object.values(ledger.lanes)) {
      const id = `${project.slug}:${lane.id}`;
      const held = lane.landApproval && !lane.landApproval.approved ? lane.landApproval : undefined;
      const was = mine.get(id);
      if (held)
        cards.push({
          open: true,
          card: card("landing", id, {
            project: project.slug,
            lane: {
              id: lane.id,
              title: lane.title,
              branch: lane.branch,
              ...(lane.onBranch ? {} : { base: lane.base }),
              landApproval: landApprovalView(held, now),
            },
            settled: null,
            ...(decider ? { decider } : {}),
          }),
        });
      else if (was?.open)
        cards.push({
          open: false,
          card: card("landing", id, {
            ...(was.data as object),
            settled: { text: landingEnd(lane), minutes: 0 },
          }),
        });
    }

    const report = await this.report(project, open, team.hitl, now);
    // A window the Human marked read is theirs now: only the report of the window still open is followed.
    for (const id of mine.keys()) if (id.startsWith(`${project.slug}:report:`) && id !== report?.id) mine.delete(id);
    // Never marked read, the whole record is news; after that, a window's card waits for something to tell.
    if (report && (report.data.window.from === null || hasNews(report.data)))
      cards.push({ open: false, card: card("report", report.id, { project: project.slug, report: report.data }) });

    for (const { card: next, open: waiting } of cards) {
      const text = shown(next.data);
      const was = mine.get(next.id);
      if (was && was.to === to && was.shown === text) continue;
      await this.deps.seats.post(to, next);
      if (waiting || next.kind === TIMELINE.report.kind)
        mine.set(next.id, { to, shown: text, data: next.data, open: waiting });
      else mine.delete(next.id);
    }
  }

  /** The report since the Human last marked it read, under an id of its own for each window they read. */
  private async report(
    project: Project,
    open: SeatView[] | undefined,
    hitl: { on: boolean; questionsPerDay: number },
    now: number,
  ): Promise<{ id: string; data: ReportView } | undefined> {
    const { kit, seats, waits } = this.deps;
    const seated: Seated = await (open ? Promise.resolve(open) : seats.open()).then(
      (list) => ({ seats: list, heardAt: (seat: string, request: string) => waits.heardAt(seat, request) }),
      (error: unknown) => ({ error: errorText(error) }),
    );
    const from = seenAt(project);
    const data = reportView(project, { kit, questionsPerDay: hitl.questionsPerDay, human: hitl.on, from, seated }, now);
    return { id: `${project.slug}:report:${from ?? 0}`, data };
  }
}
