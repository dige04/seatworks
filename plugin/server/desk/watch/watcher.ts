import { recordEvent } from "../store/event-log.ts";
import { can, roleNamed, seatOf } from "../../catalog/kit/roles.ts";
import { KeyedQueue } from "../../core/keyed-queue.ts";
import { type Answer, type Judge, type Judgement, type Question, type SeatView, midTurn } from "../../core/ports.ts";
import type { Agents } from "../seats/agents.ts";
import { caseLetters } from "../letters/case-letters.ts";
import type { DeskBase } from "../base.ts";
import { loadLedger } from "../store/ledger.ts";
import type { Letter } from "../letters/envelope.ts";
import { type Project, projectOf } from "../project/project.ts";
import type { Roster } from "../seats/roster.ts";

type Waiting = {
  project: string;
  within: number;
  provider: string;
  questions: Record<string, Question>;
  sent?: { seat: string; at: number };
  answered(judged: Judgement): void;
  failed(error: Error): void;
};

type Said = { question: string; says: string; why: string };

const UNSURE = "unsure";

const takes = (question: Question) => [
  ...(question.type === "condition" ? ["yes", "no"] : Object.keys(question.criteria)),
  UNSURE,
];

/** A seat's word as a sensor's would be: yes and no as certain, unsure as the middle; a pick as sure, unsure as none at all. */
function answerOf(question: Question, says: string): Answer {
  if (question.type === "condition") return { likely: says === "yes" ? 1 : says === "no" ? 0 : 0.5 };
  return says === UNSURE ? { pick: UNSURE, confidence: 0 } : { pick: says, confidence: 1 };
}

/**
 * The Watcher seat as the watch's judge: one per project, seated under its Supervisor when a case first needs one (a seat
 * with no parent has its first reply pushed to the Human's phone), mailed each case, and let go once no case can come.
 */
export class Watcher {
  private readonly desk: Pick<DeskBase, "kit" | "teamFor" | "mail">;
  private readonly roster: Roster;
  private readonly agents: Agents;
  private readonly waiting = new Map<string, Waiting>();
  private readonly lines = new KeyedQueue();
  private readonly stamp = Date.now().toString(36).slice(-4);
  private count = 0;

  constructor(desk: Pick<DeskBase, "kit" | "teamFor" | "mail">, roster: Roster, agents: Agents) {
    this.desk = desk;
    this.roster = roster;
    this.agents = agents;
  }

  judge(project: Project, role: string, subject: string): Judge {
    return { ask: (state, questions) => this.ask(project, role, subject, state, questions) };
  }

  private async ask(
    project: Project,
    role: string,
    subject: string,
    state: Record<string, unknown>,
    questions: Record<string, Question>,
  ): Promise<Judgement> {
    const id = `C${this.stamp}${++this.count}`;
    const within = this.desk.teamFor(project).attention.watcherAnswerMinutes;
    const answer = new Promise<Judgement>((answered, failed) =>
      this.waiting.set(id, { project: project.slug, within, provider: role, questions, answered, failed }),
    );
    try {
      const seat = await this.deliver(project, role, caseLetters.case(id, subject, state, questions));
      const provider = (await this.roster.look(seat)).provider;
      const entry = this.waiting.get(id);
      if (entry) Object.assign(entry, { provider: provider ?? role, sent: { seat, at: Date.now() } });
    } catch (error) {
      this.waiting.delete(id);
      throw error;
    }
    return answer;
  }

  /** One case after another per project, so two at once seat one Watcher, not two. */
  private deliver(project: Project, role: string, letter: Letter): Promise<string> {
    return this.lines.run(project.slug, () => this.deliverOne(project, role, letter));
  }

  private async deliverOne(project: Project, role: string, letter: Letter): Promise<string> {
    const seated = await this.roster.holderOf(project, "judge");
    if (!seated) return this.start(project, role, letter.text);
    await this.desk.mail.post(seated, letter);
    return seated;
  }

  private async start(project: Project, role: string, prompt: string): Promise<string> {
    const parent = await this.roster.supervisorFor(project);
    if (!parent) throw new Error("no Supervisor is seated, and a Watcher is seated under one");
    const seat = await this.agents.startResident(project, role, {
      parent,
      title: roleNamed(this.desk.kit, role)!.label,
      prompt,
      labels: {},
    });
    recordEvent(project, { kind: "watcher.seated", agent: seat, parent });
    return seat;
  }

  /** Why an answer is not taken, if it is not: every question once, by name, in words its question takes, with a why. */
  answer(caller: string, id: string, said: Said[]): string | undefined {
    const entry = this.waiting.get(id);
    if (!entry)
      return `${id} is not waiting for an answer: it was answered, it waited past the time it had, or the desk started again since it was sent.`;
    if (entry.sent && entry.sent.seat !== caller) return `${id} was sent to another Watcher.`;
    const asked = (name: string) => (Object.hasOwn(entry.questions, name) ? entry.questions[name] : undefined);
    const words = said.map((one) => ({
      question: one.question.trim(),
      says: one.says.trim().toLowerCase(),
      why: one.why.trim(),
    }));
    const problems = [
      ...Object.keys(entry.questions)
        .filter((name) => words.filter((one) => one.question === name).length !== 1)
        .map((name) => `answer ${name} once`),
      ...words.flatMap((one) => {
        const question = asked(one.question);
        if (!question) return [`${one.question} is no question of ${id}`];
        return [
          ...(takes(question).includes(one.says) ? [] : [`${one.question} takes ${takes(question).join(", ")}`]),
          ...(one.why ? [] : [`give ${one.question} a why`]),
        ];
      }),
    ];
    if (problems.length > 0) return `Nothing was recorded: ${[...new Set(problems)].join("; ")}.`;
    this.waiting.delete(id);
    entry.answered({
      answers: Object.fromEntries(words.map((one) => [one.question, answerOf(asked(one.question)!, one.says)])),
      model: entry.provider,
      why: Object.fromEntries(words.map((one) => [one.question, one.why])),
    });
    return undefined;
  }

  /** Each round, `open` listed after `now`: a case sent too long ago, or whose Watcher is gone, is given up; a Watcher no case can come to is let go. */
  async tend(project: Project, open: Map<string, SeatView>, now: number): Promise<void> {
    for (const [id, entry] of this.waiting) {
      if (entry.project !== project.slug || !entry.sent) continue;
      // Only a listing read after the case was sent can say its Watcher is gone.
      const gone = entry.sent.at < now && !open.has(entry.sent.seat);
      if (!gone && now - entry.sent.at < entry.within * 60_000) continue;
      this.waiting.delete(id);
      entry.failed(new Error(gone ? "the Watcher it was sent to is gone" : `no answer within ${entry.within} minutes`));
    }
    const judged = this.desk.teamFor(project).brains.seat !== undefined;
    if (judged && Object.values(loadLedger(project.state).lanes).some((lane) => lane.status === "open")) return;
    for (const seat of open.values()) {
      const idle = !midTurn(seat.status) && ![...this.waiting.values()].some((entry) => entry.sent?.seat === seat.id);
      if (idle && can(seatOf(this.desk.kit, seat.provider)?.role, "judge") && projectOf(seat.cwd).slug === project.slug)
        await this.roster.archive(seat.id);
    }
  }
}
