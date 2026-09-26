import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { memo, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Button, Empty } from "./bits.tsx";
import type { FlowAsk, FlowLane, FlowSeat, FlowView } from "../../shared/flow-views.ts";
import { leadState, seatName, seatText, taskState, where } from "../format/flow.ts";
import { lasting } from "../format/time.ts";
import { ApprovalsCards } from "./approvals.tsx";
import { QuestionCards } from "./questions.tsx";
import { WatchCard } from "./watching.tsx";

/** Paseo's own navigation, absent on older hosts: every place that opens something hides without it. */
type Navigation = PluginSurfaceProps["navigation"];

type Props = {
  following: boolean;
  human: boolean;
  judgeRole: string;
  flow: FlowView | null;
  error: string | null;
  live: boolean;
  theme: PluginTheme;
  disabled: boolean;
  onLive: (live: boolean) => void;
  onOpen: (lane: string) => void;
  navigation: Navigation;
};

const NODE_W = 232;
const NODE_H = 80;
const COL_GAP = 44;
const ROW_GAP = 12;
const PAD = 16;

function useStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      canvas: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        overflow: "hidden" as const,
      },
      node: {
        width: NODE_W,
        height: NODE_H,
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      caret: { color: theme.colors.foregroundMuted, fontSize: 12 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      alive: { color: theme.colors.statusSuccess, fontSize: 12, fontWeight: "500" as const },
      quiet: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
      lane: { flexDirection: "row" as const, paddingHorizontal: PAD, paddingTop: PAD, gap: 0 },
      children: { gap: ROW_GAP },
      stub: { flexDirection: "row" as const, alignItems: "center" as const },
      rail: { width: 1, backgroundColor: theme.colors.border },
      link: { width: COL_GAP / 2, height: 1, backgroundColor: theme.colors.border },
      spine: { width: COL_GAP / 2, height: 1, backgroundColor: theme.colors.border, alignSelf: "center" as const },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
      },
      labels: { flex: 1, gap: 4 },
    }),
    [theme],
  );
}

/** A seat's chat in Paseo; nothing when the seat is gone or the host cannot open one. */
const chatOf = (navigation: Navigation, seat: FlowSeat | null) =>
  navigation && seat && seat.status !== "gone" ? () => navigation.openAgent({ agentId: seat.id }) : undefined;

const Node = memo(function Node({
  title,
  hint,
  state,
  alive,
  caret,
  theme,
  onPress,
  onChat,
}: {
  title: string;
  hint: string;
  state: string;
  alive: boolean;
  caret?: string;
  theme: PluginTheme;
  onPress?: () => void;
  onChat?: () => void;
}) {
  const styles = useStyles(theme);
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={title}
      disabled={!onPress}
      onPress={onPress}
      style={styles.node}
    >
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {caret ? <Text style={styles.caret}>{caret}</Text> : null}
        {onChat ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${title} in Paseo`}
            hitSlop={8}
            onPress={onChat}
          >
            <Text style={styles.caret}>›</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.hint} numberOfLines={1}>
        {hint}
      </Text>
      <Text style={alive ? styles.alive : styles.quiet} numberOfLines={1}>
        {state}
      </Text>
    </Pressable>
  );
});

/** `answers` is who answers a permission prompt of this lane's seats; `human`, whether the Human is in the loop. */
type LaneProps = { lane: FlowLane; answers: string; human: boolean; theme: PluginTheme; navigation: Navigation };

function KeptLead({ lane, answers, theme, navigation }: LaneProps) {
  const styles = useStyles(theme);
  return (
    <View style={styles.lane}>
      <Node
        theme={theme}
        title={`Kept ${seatName(lane.lead)} · ${lane.id} ${lane.title}`}
        hint={`${lane.landed ? "landed" : "dropped"}${lane.copy ? ` · keeps copy ${lane.copy}` : ""} · until released`}
        state={seatText(lane.lead, answers)}
        alive={Boolean(lane.lead && lane.lead.status !== "gone")}
        onChat={chatOf(navigation, lane.lead)}
      />
    </View>
  );
}

function Peers({ lane, answers, theme, navigation }: LaneProps) {
  const styles = useStyles(theme);
  return (
    <>
      <View style={styles.spine} />
      <View style={styles.rail} />
      <View style={styles.children}>
        {lane.tasks.map((task) => (
          <View key={task.id} style={styles.stub}>
            <View style={styles.link} />
            <Node
              theme={theme}
              title={`${task.peer ? seatName(task.peer) : task.kind} · ${task.id}${task.mode === "parallel" ? " · parallel" : ""}`}
              hint={task.copy ? `${task.copy} · ${task.title}` : task.title}
              state={taskState(task, answers)}
              alive={task.status === "running" || task.status === "rework"}
              onChat={chatOf(navigation, task.peer)}
            />
          </View>
        ))}
        {lane.kept.map((seat) => (
          <View key={seat.id} style={styles.stub}>
            <View style={styles.link} />
            <Node
              theme={theme}
              title={`${seatName(seat)} · kept · ${seat.task}`}
              hint="stays until its Lead releases it"
              state={seatText(seat, answers)}
              alive={false}
              onChat={chatOf(navigation, seat)}
            />
          </View>
        ))}
      </View>
    </>
  );
}

const Lane = memo(function Lane(props: LaneProps & { onOpen: (id: string) => void }) {
  const { lane, answers, human, theme, onOpen, navigation } = props;
  const styles = useStyles(theme);
  if (lane.status === "closed") return <KeptLead {...props} />;
  if (lane.status === "waiting") {
    return (
      <View style={styles.lane}>
        <Node
          theme={theme}
          title={`Waiting · ${lane.id} ${lane.title}`}
          hint={`after ${(lane.after ?? []).join(", ")}`}
          state={lane.held ? `not open: ${lane.held}` : "opens once those land"}
          alive={false}
        />
      </View>
    );
  }
  const opens = lane.taskCount > 0 || lane.kept.length > 0;
  return (
    <View style={styles.lane}>
      <View style={{ gap: 8 }}>
        <Node
          theme={theme}
          title={`${seatName(lane.lead)} · ${lane.id} ${lane.title}`}
          hint={`${where(lane)} · ${lane.base ? `${lane.branch} off ${lane.base}` : `${lane.branch}, carried on in place`}`}
          state={leadState(lane, answers, human)}
          alive={Boolean(lane.lead && lane.lead.status !== "gone" && !lane.onHold)}
          caret={opens ? (lane.open ? "▾" : "▸") : undefined}
          onPress={opens ? () => onOpen(lane.id) : undefined}
          onChat={chatOf(navigation, lane.lead)}
        />
        {navigation && lane.workspaceId && lane.open ? (
          <Button
            label={`Open ${lane.id}'s diff`}
            theme={theme}
            onPress={() => navigation.openWorkspace({ workspaceId: lane.workspaceId! })}
          />
        ) : null}
      </View>
      {lane.open && (lane.tasks.length > 0 || lane.kept.length > 0) ? <Peers {...props} /> : null}
    </View>
  );
});

/** The asks still open between seats, which the Human only reads: answering them is the seats' own work. */
function AsksCard({ asks, theme }: { asks: FlowAsk[]; theme: PluginTheme }) {
  const styles = useStyles(theme);
  return (
    <SettingsCard>
      {asks.map((ask) => (
        <View key={ask.id} style={styles.row}>
          <View style={styles.labels}>
            <Text style={styles.title}>{`${ask.id} · ${ask.kind}`}</Text>
            <Text
              style={styles.hint}
            >{`from ${ask.from ?? "a seat"} to ${ask.to ?? "a seat no longer on record"}`}</Text>
          </View>
          <Text style={styles.quiet}>{lasting(ask.minutes)}</Text>
        </View>
      ))}
    </SettingsCard>
  );
}

export function FlowSection({
  following,
  human,
  judgeRole,
  flow,
  error,
  live,
  theme,
  disabled,
  onLive,
  onOpen,
  navigation,
}: Props) {
  const styles = useStyles(theme);
  const empty = flow !== null && flow.lanes.length === 0 && flow.supervisors.length === 0;
  const supervisor = flow?.supervisors[0]?.label ?? "seat that supervises";
  const answers = human ? "you" : `the ${supervisor}`;

  return (
    <SettingsSection
      title="Flow"
      info="Only what the team is holding right now, seats kept until their superior releases them included. Open a lane to see its Peers."
    >
      <SettingsCard>
        <SettingsSwitch
          label="Follow the team live"
          hint={
            !following
              ? "The default every project starts with. A project's own Flow tab is what reads its ledger."
              : live
                ? "Reads the ledger every few seconds while this tab is open."
                : "Switched off: read once each time this tab opens, so what waits for you still shows."
          }
          value={live}
          onValueChange={onLive}
          disabled={disabled}
        />
      </SettingsCard>

      {flow ? (
        <QuestionCards
          project={flow.project}
          questions={flow.questions}
          decider={human ? undefined : supervisor}
          theme={theme}
        />
      ) : null}
      {flow ? (
        <ApprovalsCards
          project={flow.project}
          lanes={flow.lanes}
          decider={human ? undefined : supervisor}
          theme={theme}
        />
      ) : null}

      {error ? (
        <SettingsCard>
          <Empty theme={theme} title="The flow could not be read" body={error} />
        </SettingsCard>
      ) : flow === null ? (
        <SettingsCard>
          <Empty
            theme={theme}
            title={following ? "Reading the ledger" : "Flow follows one project"}
            body={
              following
                ? "This refreshes on its own."
                : "Open a project to watch its lanes; the switch above only sets the default."
            }
          />
        </SettingsCard>
      ) : empty ? (
        <SettingsCard>
          <Empty
            theme={theme}
            title="Nothing is running"
            body="Open a lane and its Lead, Peers and asks appear here."
          />
        </SettingsCard>
      ) : (
        <View style={styles.canvas}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ paddingBottom: PAD }}>
              {flow.supervisors.map((seat) => (
                <View key={seat.id} style={styles.lane}>
                  <Node
                    theme={theme}
                    title={seatName(seat)}
                    hint={seat.id}
                    state={seatText(seat)}
                    alive={seat.status !== "gone"}
                    onChat={chatOf(navigation, seat)}
                  />
                </View>
              ))}
              {flow.lanes.map((lane) => (
                <Lane
                  key={lane.id}
                  lane={lane}
                  answers={answers}
                  human={human}
                  theme={theme}
                  onOpen={onOpen}
                  navigation={navigation}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {flow && flow.moreLanes > 0 ? (
        <SettingsCard>
          <SettingsRow
            label={`${flow.moreLanes} more lane${flow.moreLanes === 1 ? "" : "s"}`}
            hint={`This screen draws the first ${flow.lanes.length} lanes and no more. The rest are open, waiting, or closed with their Lead kept; the status page lists every one of them.`}
          />
        </SettingsCard>
      ) : null}

      {flow ? <WatchCard watch={flow.watch} supervisor={supervisor} judgeRole={judgeRole} theme={theme} /> : null}

      {flow && flow.asks.length > 0 ? <AsksCard asks={flow.asks} theme={theme} /> : null}
    </SettingsSection>
  );
}
