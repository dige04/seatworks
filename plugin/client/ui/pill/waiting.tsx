import type { PluginButtonContentProps, PluginButtonIconProps, PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { flowRpc, landDecideRpc, questionAnswerRpc } from "../../../shared/rpc.ts";
import type { FlowView } from "../../../shared/flow-views.ts";
import { useFlow } from "../../state/flow.ts";
import { type HeldLane, LandingCard } from "../decide/landing-card.tsx";
import { QuestionCard } from "../decide/question-card.tsx";
import { FONT, SPACE } from "../kit/theme.ts";

const PROJECT_LABEL = "seatworks.project";
const EVERY_MS = 10_000;

/** A failed read or listing is only a missed count: the next poll reads again. */
const nextPollRetries = () => undefined;

/** What waits on the Human in a project: its open questions and the landings held for their word. */
function waitingOf(flow: FlowView): { questions: FlowView["questions"]; lanes: HeldLane[] } {
  const lanes = flow.lanes.filter((lane): lane is FlowView["lanes"][number] & HeldLane =>
    Boolean(lane.landApproval && !lane.landApproval.approved),
  );
  return { questions: flow.questions, lanes };
}

function WaitingIcon({ theme, size }: PluginButtonIconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.statusWarning }} />
    </View>
  );
}

/** The popover's body: the same cards the Supervisor's chat holds, answerable from whichever chat is open. */
function waitingContent(project: string) {
  return function WaitingContent({ theme, layout }: PluginButtonContentProps) {
    const answer = useRpc(questionAnswerRpc);
    const decide = useRpc(landDecideRpc);
    const { flow } = useFlow(project, true, EVERY_MS / 2, "");
    const muted = { fontSize: FONT.small, color: theme.colors.foregroundMuted };
    if (!flow) return <Text style={muted}>Reading what waits on you.</Text>;
    const { questions, lanes } = waitingOf(flow);
    return (
      <ScrollView contentContainerStyle={{ gap: SPACE.sm }}>
        {questions.length + lanes.length === 0 ? <Text style={muted}>Nothing waits on you.</Text> : null}
        {questions.map((question) => (
          <QuestionCard key={question.id} project={project} question={question} theme={theme} compact answer={answer} />
        ))}
        {lanes.map((lane) => (
          <LandingCard
            key={lane.id}
            project={project}
            lane={lane}
            theme={theme}
            compact={layout.compact}
            decide={decide}
          />
        ))}
        <Text style={muted}>Answering here settles the card in the Supervisor's chat too.</Text>
      </ScrollView>
    );
  };
}

type Pill = { project: string; update: (label: string, count: number) => void; remove: () => void };

/** A "needs you" pill on every Seatworks seat's chat, counting what waits on the Human in that seat's project. */
export function addWaitingPills(client: PluginClientContext): () => void {
  const pills = new Map<string, Pill>();
  const counts = new Map<string, number>();
  const contents = new Map<string, ReturnType<typeof waitingContent>>();
  const since = new Map<string, string>();

  const label = (count: number) => `${count} need${count === 1 ? "s" : ""} you`;
  const show = (project: string) => {
    const count = counts.get(project) ?? 0;
    for (const pill of pills.values()) if (pill.project === project) pill.update(label(count), count);
  };
  const seat = (agentId: string, workspaceId: string, project: string) => {
    if (pills.get(agentId)?.project === project) return;
    pills.get(agentId)?.remove();
    const content = contents.get(project) ?? waitingContent(project);
    contents.set(project, content);
    const count = counts.get(project) ?? 0;
    const registration = client.addComposerPill({
      id: "waiting",
      workspaceId,
      agentId,
      button: {
        title: "Waiting on you",
        icon: WaitingIcon,
        label: label(count),
        visible: count > 0,
        behavior: { kind: "popover", Content: content },
      },
    });
    pills.set(agentId, {
      project,
      update: (text, next) => registration.update({ label: text, visible: next > 0 }),
      remove: () => registration.remove(),
    });
  };
  const gone = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const read = async (project: string) => {
    const known = since.get(project);
    const answer = await client.rpc(flowRpc, known ? { project, since: known } : { project });
    if ("error" in answer || "unchanged" in answer) return;
    since.set(project, answer.revision);
    const { questions, lanes } = waitingOf(answer);
    counts.set(project, questions.length + lanes.length);
    show(project);
  };
  const poll = () => {
    for (const project of new Set([...pills.values()].map((pill) => pill.project)))
      read(project).catch(nextPollRetries);
  };

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") return gone(update.agentId);
    const { id, workspaceId, labels, archivedAt } = update.agent;
    const project = labels[PROJECT_LABEL];
    if (!project || !workspaceId || archivedAt) return gone(id);
    seat(id, workspaceId, project);
  });
  client.paseo.agents
    .list()
    .then(({ entries }) => {
      for (const { agent } of entries) {
        const project = agent.labels[PROJECT_LABEL];
        if (project && agent.workspaceId && !agent.archivedAt) seat(agent.id, agent.workspaceId, project);
      }
      poll();
    })
    .catch(nextPollRetries);
  const timer = setInterval(poll, EVERY_MS);
  return () => {
    clearInterval(timer);
    unsubscribe();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}
