import type { Question } from "../../domain/question.ts";
import type { Ask } from "../../domain/ask.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Letter, firstLine, fyi, mail } from "./envelope.ts";
import { SAY_IN_REPORT } from "./next.ts";

const WEIGHED = {
  changes: "it changes the plan",
  alternative: "another sound option; the plan stands",
  minor: "not worth stopping the work for; the plan stands",
};
/** How an answer weighed a challenge and why, in one line; nothing for an ask that was no challenge. */
const weighed = (ask: Ask): string[] =>
  ask.why ? [`${ask.verdict ? `Weighed: ${WEIGHED[ask.verdict]}. ` : ""}Why: ${ask.why}`] : [];

const theirDefault = (ask: Ask): string[] => (ask.default ? ["", `Their default: ${ask.default}`] : []);

/** Whoever supervises and an ask: a Peer's reaches it only when its Lead is gone, and a question may be the Human's. */
function askNext(ask: Ask): string {
  if (ask.task)
    return `Its Lead is gone: answer ${ask.id} if you can; replace_lead puts a new Lead on the lane where it stands.`;
  if (ask.kind === "question")
    return `If CONTEXT.md settles it, answer ${ask.id}; if it is what the project does, ask the Human and write it into CONTEXT.md; else decide. The Lead runs on its default.`;
  return `Decide and answer ${ask.id}; what only the Human can give (access, a key, spending) or a kit or setup error goes to them word for word.`;
}

/** The Lead keeping its lane off an irreversible question's decision, until whoever supervises says how it goes on. */
const keptOffBy = (question: Question) =>
  question.class === "irreversible" && question.lane ? `the Lead of ${question.lane}` : undefined;

/** What the Human's word asks of whoever asked: turn round what went ahead in their silence if they chose otherwise. */
function answeredNext(question: Question): string {
  const lead = keptOffBy(question);
  if (question.status === "declined")
    return lead
      ? `The call is yours now: decide it, and tell ${lead} how the lane goes on`
      : "The call is yours now: decide it and carry that where it applies";
  if (question.status === "canceled")
    return lead
      ? `It is off their queue: tell ${lead} how the lane goes on without it, or ask again if it still matters`
      : "It is off their queue: go on without it, or ask again if it still matters";
  if (lead)
    return `Tell ${lead} their choice and how the lane goes on, and write it into CONTEXT.md if it settles the concept`;
  if (question.class === "irreversible")
    return "Carry their choice where it applies, and write it into CONTEXT.md if it settles the concept";
  return "If their choice is not what went ahead while they were silent, turn that round, and write it into CONTEXT.md if it settles the concept";
}

export const askLetters = {
  /** `concept` is where the project's CONTEXT.md is, when there is one: a Lead answers its Peers from it first. */
  askTo(ask: Ask, from: string, reader: "lead" | "supervisor", concept?: string): Letter {
    const read = concept ? `${concept}, the brief and the code` : "the brief and the code";
    const challenge = ask.kind === "challenge";
    const next = challenge
      ? `Weigh the evidence and answer ${ask.id} with why and a verdict: changes, alternative (another sound option the plan need not take) or minor (not worth stopping for). Changing the plan needs its basis; keeping it needs a reason the asker can argue with.`
      : reader === "lead"
        ? `Answer ${ask.id} from ${read}; if only the Supervisor can, ask up and tell the Peer to wait.`
        : askNext(ask);
    const head = challenge ? `CHALLENGE ${ask.id} from ${from}` : `ASK ${ask.id} (${ask.kind}) from ${from}`;
    const disputes = ask.disputes ? ["", `Disputes: ${ask.disputes}`] : [];
    return mail("ask", [ask.id], [head, ...disputes, "", ask.text, ...theirDefault(ask)].join("\n"), next);
  },

  humanAnswered(question: Question, lane: Lane | undefined): Letter {
    const word =
      question.status === "declined"
        ? "they declined to decide it"
        : question.status === "canceled"
          ? "they took it off their queue"
          : (question.answer?.choice ?? "");
    const lines = [`HUMAN ANSWERED ${question.id} (${firstLine(question.question)}), on the panel: ${word}.`];
    if (question.answer?.text) lines.push("", "Their note, their own words:", question.answer.text);
    if (lane?.onHold) lines.push("", `Lane ${lane.id} is still on hold for it.`);
    const next = answeredNext(question);
    return mail(
      "humananswered",
      [question.id],
      lines.join("\n"),
      lane?.onHold ? `${next}; then resume_lane ${lane.id}.` : `${next}.`,
    );
  },

  answered(ask: Ask): Letter {
    return mail(
      "answer",
      [ask.id],
      [`ANSWER to your ask ${ask.id}`, "", ask.answer ?? "", ...(ask.why ? ["", ...weighed(ask)] : [])].join("\n"),
      "Go on with your work from it.",
    );
  },

  /**
   * The seat an ask was put to, told what its asker was told and by whom: the Supervisor may answer a Lead's ask, never out
   * of its sight. `waited` false: a Peer's ask put to the Supervisor while its lane had no Lead, told to its Lead now.
   */
  answeredFor(ask: Ask, from: string, by: string, leads = true, waited = true): Letter {
    const put = waited ? "which was waiting on you" : "put to the Supervisor while your lane had no Lead";
    const text = [
      `ANSWERED FOR YOU: ${ask.id} (${ask.kind}) from ${from}, ${put}, was answered by ${by}.`,
      "",
      "The question:",
      ask.text,
      "",
      "The answer it was given:",
      ask.answer ?? "",
      ...weighed(ask),
      "",
      // Only an ask with a task has a Peer to speak of, and acceptance is only a Lead's to judge.
      ask.task && leads
        ? `Nothing else moved: ${ask.task} is still owned by the same Peer, on the same branch, and accepting it is still yours to judge.`
        : "Nothing else moved.",
    ].join("\n");
    return mail(
      "answeredFor",
      [ask.id],
      text,
      leads ? SAY_IN_REPORT : "If it changes a decision of yours, carry that into the lane.",
    );
  },

  pending(question: Question): Letter {
    return mail(
      "pending",
      [question.id],
      `DECISION PENDING ${question.id}, the Human's to make: ${firstLine(question.question)}\n\nNothing it decides goes ahead until they answer; what it does not touch goes on.`,
      "Keep the lane off what it decides, and carry on with the rest; you hear when it is settled, and the Supervisor tells you how the lane goes on.",
    );
  },

  /** The Lead keeping its lane off a decision hears it is settled, not the Human's words: the Supervisor brings those. */
  settled(question: Question): Letter {
    const how =
      question.status === "answered"
        ? "the Human answered it"
        : question.status === "declined"
          ? "the Human declined to decide it"
          : question.answer?.by === "supervisor"
            ? "it was withdrawn"
            : "the Human took it off their queue";
    return fyi(
      mail(
        "settled",
        [question.id],
        `SETTLED ${question.id}, the decision your lane kept off: ${how}.`,
        "Nothing now: the Supervisor tells you how the lane goes on.",
      ),
    );
  },

  /** `concept` is where the project's CONTEXT.md is, when there is one: the Human's word comes first. */
  lapsed(ask: Ask, minutes: number, concept?: string): Letter {
    const from = concept ? `${concept}, your directive and the code` : "your directive and the code";
    return mail(
      "lapsed",
      [ask.id],
      `NO ANSWER to your ask ${ask.id} in ${minutes} minutes: ${firstLine(ask.text)}`,
      `Settle it yourself from ${from}, or go on with your default; say which in your report.`,
    );
  },

  /** Whoever supervises hears the ask it left went back to its Lead, so it does not answer what is settled already. */
  lapsedFor(ask: Ask, minutes: number): Letter {
    return fyi(
      mail(
        "lapsed",
        [ask.id],
        `LAPSED ${ask.id} from the Lead of ${ask.lane ?? "a lane"}: unanswered for ${minutes} minutes, so its Lead settles it from what it has.`,
        "Nothing now; tell the Lead if what it settles on is wrong.",
      ),
    );
  },
};
