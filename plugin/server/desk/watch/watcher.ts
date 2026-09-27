import { recordEvent } from "../store/event-log.ts";
import { can, roleNamed, seatOf } from "../../catalog/kit/roles.ts";
import { KeyedQueue } from "../../core/keyed-queue.ts";
import { type Answer, type Judge, type Judgement, type Question, type SeatView, midTurn } from "../../core/ports.ts";
import type { Agents } from "../seats/agents.ts";
import { caseLetters } from "../letters/case-letters.ts";
import type { DeskBase } from "../base.ts";
import { Folded } from "../store/assessments.ts";
import { loadLedger } from "../store/ledger.ts";
import type { Letter } from "../letters/envelope.ts";
import { type Project, projectOf } from "../project/project.ts";
import type { Roster } from "../seats/roster.ts";

/** What a case is about: the seat watched, the task or lane its work is on, and whether a look or which decision. */
export type About = { seat: string; subject: string; episode: string };

/**
 * A case asked and not yet answered, under `key`, its seat, subject and episode: `sent` once posted to a Watcher,
 * `delivered` once that Watcher was given it.
 */
type Waiting = {
  project: string;
  key: string;
  within: number;
  provider: string;
  state: Record<string, unknown>;
  questions: Record<string, Question>;
  sent?: { seat: string; at: number };
  delivered?: number;
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

  judge(project: Project, role: string, about: About): Judge {
    return { ask: (state, questions) => this.ask(project, role, about, state, questions) };
  }

  /** One case waits per seat, subject and episode: a newer one takes in what the one still queued would have asked. */
  private async ask(
    project: Project,
    role: string,
    about: About,
    asked: Record<string, unknown>,
    newer: Record<string, Question>,
  ): Promise<Judgement> {
    const id = `C${this.stamp}${++this.count}`;
    const key = `${about.seat}:${about.subject}:${about.episode}`;
    const older = await this.fold(project, key, about, id);
    const state = older ? merged(older.state, asked) : asked;
    const questions = older ? { ...older.questions, ...newer } : newer;
    const within = this.desk.teamFor(project).attention.watcherAnswerMinutes;
    const answer = new Promise<Judgement>((answered, failed) =>
      this.waiting.set(id, { project: project.slug, key, within, provider: role, state, questions, answered, failed }),
    );
    try {
      const letter = caseLetters.case(id, about.subject, state, questions);
      const { seat, started } = await this.deliver(project, role, letter);
      const provider = (await this.roster.look(seat)).provider;
      const entry = this.waiting.get(id);
      const at = Date.now();
      // A Watcher seated for a case is given it as its prompt.
      if (entry)
        Object.assign(entry, { provider: provider ?? role, sent: { seat, at }, ...(started && { delivered: at }) });
    } catch (error) {
      this.waiting.delete(id);
      throw error;
    }
    return answer;
  }

  /** The case still queued under `key`, taken back from its Watcher's mail and ended as folded into `into`; none once its Watcher has it. */
  private async fold(project: Project, key: string, about: About, into: string): Promise<Waiting | undefined> {
    const found = [...this.waiting].find(
      ([, entry]) => entry.project === project.slug && entry.key === key && entry.sent && entry.delivered === undefined,
    );
    if (!found) return undefined;
    const [id, entry] = found;
    if (!(await this.desk.mail.withdraw(entry.sent!.seat, `case:${id}`)) || this.waiting.get(id) !== entry)
      return undefined;
    this.waiting.delete(id);
    recordEvent(project, { kind: "watch.superseded", agent: about.seat, subject: about.subject, case: id, into });
    entry.failed(new Folded(`folded into ${into}`));
    return entry;
  }

  /** Cases whose letters reached their Watcher at `at`, which may be while they are still being posted: from then on they have the time they are given. */
  delivered(letters: { key: string }[], at: number): void {
    for (const letter of letters) {
      const entry = this.waiting.get(letter.key.replace(/^case:/, ""));
      if (entry) entry.delivered ??= at;
    }
  }

  /** One case after another per project, so two at once seat one Watcher, not two. */
  private deliver(project: Project, role: string, letter: Letter): Promise<{ seat: string; started: boolean }> {
    return this.lines.run(project.slug, () => this.deliverOne(project, role, letter));
  }

  private async deliverOne(
    project: Project,
    role: string,
    letter: Letter,
  ): Promise<{ seat: string; started: boolean }> {
    const seated = await this.roster.holderOf(project, "judge");
    if (!seated) return { seat: await this.start(project, role, letter.text), started: true };
    await this.desk.mail.post(seated, letter);
    return { seat: seated, started: false };
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

  /**
   * Each round, `open` listed after `now`: a case is given up when its Watcher is gone, when its time has run since its
   * Watcher got it, or when it never got it in twice that time; a Watcher no case can come to is let go.
   */
  async tend(project: Project, open: Map<string, SeatView>, now: number): Promise<void> {
    for (const [id, entry] of this.waiting) {
      if (entry.project !== project.slug || !entry.sent) continue;
      // Only a listing read after the case was sent can say its Watcher is gone.
      const gone = entry.sent.at < now && !open.has(entry.sent.seat);
      const minutes = (now - (entry.delivered ?? entry.sent.at)) / 60_000;
      if (!gone && minutes < entry.within * (entry.delivered === undefined ? 2 : 1)) continue;
      this.waiting.delete(id);
      const why = gone
        ? "the Watcher it was sent to is gone"
        : entry.delivered === undefined
          ? "never reached the Watcher"
          : `no answer within ${entry.within} minutes`;
      entry.failed(new Error(why));
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

/** A newer case's fields over an older's, lists joined, so nothing the older would have read is lost. */
function merged(older: Record<string, unknown>, newer: Record<string, unknown>): Record<string, unknown> {
  const both = { ...older, ...newer };
  for (const [field, value] of Object.entries(newer)) {
    const was: unknown = older[field];
    if (Array.isArray(was) && Array.isArray(value))
      both[field] = [...new Set<unknown>((was as unknown[]).concat(value as unknown[]))];
  }
  return both;
}
