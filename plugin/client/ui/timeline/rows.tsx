import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import type { z } from "zod";
import { landDecideRpc, questionAnswerRpc } from "../../../shared/rpc.ts";
import { TIMELINE } from "../../../shared/timeline-items.ts";
import { ago } from "../../format/time.ts";
import { SettledLine } from "../decide/frame.tsx";
import { LandingCard } from "../decide/landing-card.tsx";
import { QuestionCard } from "../decide/question-card.tsx";
import { ReportCard } from "../decide/report-card.tsx";

type Row<K extends keyof typeof TIMELINE> = PluginTimelineItemProps<z.output<(typeof TIMELINE)[K]["schema"]>>;

function QuestionRow({ item, theme, layout }: Row<"question">) {
  const answer = useRpc(questionAnswerRpc);
  const { project, question, settled, decider } = item.data;
  if (settled)
    return (
      <SettledLine
        theme={theme}
        tone="done"
        text={`${question.question} · ${settled.text}`}
        when={ago(settled.minutes)}
      />
    );
  return (
    <QuestionCard
      project={project}
      question={question}
      theme={theme}
      compact={layout.compact}
      answer={answer}
      decider={decider}
    />
  );
}

function LandingRow({ item, theme, layout }: Row<"landing">) {
  const decide = useRpc(landDecideRpc);
  const { project, lane, settled, decider } = item.data;
  if (settled)
    return (
      <SettledLine
        theme={theme}
        tone="done"
        text={`${lane.id} ${lane.title} · ${settled.text}`}
        when={ago(settled.minutes)}
      />
    );
  return (
    <LandingCard
      project={project}
      lane={lane}
      theme={theme}
      compact={layout.compact}
      decide={decide}
      decider={decider}
    />
  );
}

function ReportRow({ item, theme }: Row<"report">) {
  return <ReportCard project={item.data.project} report={item.data.report} theme={theme} />;
}

/** Draws the rows the desk appends to the Supervisor's chat; the desk owns when they appear and when they settle. */
export function addTimelineRows(client: PluginClientContext): Array<() => void | Promise<void>> {
  return [
    client.addTimelineRenderer({ ...TIMELINE.question, Component: QuestionRow }),
    client.addTimelineRenderer({ ...TIMELINE.landing, Component: LandingRow }),
    client.addTimelineRenderer({ ...TIMELINE.report, Component: ReportRow }),
  ];
}
