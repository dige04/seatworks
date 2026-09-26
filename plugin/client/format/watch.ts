import type { WatchIncident, WatchJudge } from "../../shared/flow-views.ts";

const HELD: Record<string, string> = {
  budget: "held · the lane's limit for today is reached",
  probation: "held · most of this kind's last ten were marked noise",
  nobody: "held · nobody is seated to tell",
  shadow: "recorded · mail is off",
};

/** Where an incident has got to, as the card counts it; `supervisor` is the kit's label for the role told. */
export function incidentState(item: WatchIncident, supervisor: string): string {
  if (item.told) return `told the ${supervisor}`;
  return (item.held ? HELD[item.held] : undefined) ?? "recorded";
}

/** Who answers the watch's questions and how that stands, in words and a tone; `judgeRole` is the Team chip it is set on. */
export function judgeWords(
  judge: WatchJudge,
  judgeRole: string,
): { title: string; hint: string; tone: "success" | "warning" | "muted" } {
  const kept = "Its answers are kept in assessments.log; no seat is sent them.";
  if (judge.state === "off")
    return {
      title: "No brain reads what the watch sees",
      hint: `Brains is off: set it on Team, on the ${judgeRole}. The code's own facts go on.`,
      tone: "muted",
    };
  if (judge.state === "nokey")
    return {
      title: `${judge.label} is asked nothing: it has no key`,
      hint: `Add its ${judge.detail} on Team, under Machine defaults, on the ${judgeRole}. The code's own facts go on.`,
      tone: "muted",
    };
  if (judge.state === "failing")
    return {
      title: `${judge.label} is not answering`,
      hint: `${judge.detail}. The code's own facts go on; nothing waits for an answer.`,
      tone: "warning",
    };
  return {
    title: `${judge.label} answers the watch's questions`,
    hint: judge.state === "waiting" ? `Nothing has been asked of it yet. ${kept}` : kept,
    tone: "success",
  };
}
