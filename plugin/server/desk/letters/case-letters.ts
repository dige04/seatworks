import type { Question } from "../../core/ports.ts";
import { type Letter, fyi, list, mail } from "./envelope.ts";

/** One check review asked, what it answered, and the criterion that answer meets, if it met one. */
type Read = { question: Question; verdict: string; sure: number | undefined };

function shown(value: unknown): string {
  if (Array.isArray(value)) return list(value.map(String));
  if (typeof value === "string") return value.trim() || "(empty)";
  return JSON.stringify(value);
}

function asked(name: string, question: Question): string[] {
  const { instructions } = question;
  const words = typeof instructions === "string" ? instructions : (instructions.question ?? "");
  const filled =
    typeof instructions === "string"
      ? []
      : Object.entries(instructions)
          .filter(([field]) => field !== "question")
          .map(([field, value]) => `   ${field}: ${value}`);
  const meanings =
    question.type === "condition"
      ? [`   yes: ${question.criteria.true}`, `   no: ${question.criteria.false}`]
      : Object.entries(question.criteria).map(([choice, meaning]) => `   ${choice}: ${meaning}`);
  return [`${name}: ${words}`, ...filled, ...meanings];
}

export const caseLetters = {
  /** One moment of the record, as the fields the desk read, and the questions about it. */
  case(id: string, subject: string, state: Record<string, unknown>, questions: Record<string, Question>): Letter {
    const fields = Object.entries(state).flatMap(([name, value]) => [`${name}:`, shown(value), ""]);
    const lines = [
      `CASE ${id} about ${subject}: questions on the fields below.`,
      "",
      ...fields,
      "Questions:",
      ...Object.entries(questions).flatMap(([name, question]) => [...asked(name, question), ""]),
    ];
    return mail(
      "case",
      [id],
      lines.join("\n").trimEnd(),
      `judge ${id}: for each question yes, no, unsure or a choice's name, with why in one sentence quoting the words that decided it.`,
    );
  },

  /** What review's sensor read in one moment of `subject`'s work, for whoever decides on it: a lead to check, never a verdict. */
  evidence(subject: string, episode: string, by: string, read: Read[]): Letter {
    const lines = read.map(({ question, verdict, sure }) => {
      const { instructions } = question;
      const words = typeof instructions === "string" ? instructions : (instructions.question ?? "");
      const filled =
        typeof instructions === "string" ? [] : Object.entries(instructions).filter(([f]) => f !== "question");
      const given = filled.length > 0 ? ` (${filled.map(([field, value]) => `${field}: ${value}`).join("; ")})` : "";
      const key = question.type === "condition" ? { yes: "true", no: "false" }[verdict] : verdict;
      const meant = key && Object.hasOwn(question.criteria, key) ? `: ${question.criteria[key]}` : "";
      return `- ${words}${given} ${verdict}${sure === undefined ? "" : `, ${sure.toFixed(2)} sure`}${meant}`;
    });
    const text = [
      `EVIDENCE on ${subject}, about ${episode}: what ${by} read in its words.`,
      "",
      ...lines,
      "",
      "It read the words, not the code: a lead to check, never a verdict.",
    ];
    return fyi(
      mail(
        "evidence",
        [subject, episode],
        text.join("\n"),
        `Weigh it when you decide on ${subject}; nothing waits on it.`,
      ),
    );
  },
};
