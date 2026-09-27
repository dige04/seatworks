import type { PluginTheme, RpcInput } from "@getpaseo/plugin";
import { useState } from "react";
import { Text, View } from "react-native";
import type { landDecideRpc } from "../../../shared/rpc.ts";
import type { FlowLane } from "../../../shared/flow-views.ts";
import type { LandDecided } from "../../../shared/views.ts";
import { ago } from "../../format/time.ts";
import { Button } from "../kit/button.tsx";
import { Dot } from "../kit/mark.tsx";
import { TextField } from "../kit/text-field.tsx";
import { FONT, RADIUS, SPACE, useStyles } from "../kit/theme.ts";
import { DecisionFrame } from "./frame.tsx";
import { useSend } from "./send.ts";

type Decide = (input: RpcInput<typeof landDecideRpc>) => Promise<LandDecided>;

/** A lane held for the Human's word before it lands: what the lane is, why it waits, and the desk's facts. */
export type HeldLane = Pick<FlowLane, "id" | "title" | "base" | "branch"> & {
  landApproval: NonNullable<FlowLane["landApproval"]>;
};

type Props = {
  project: string;
  lane: HeldLane;
  theme: PluginTheme;
  compact: boolean;
  decide: Decide;
  decider?: string;
};

const decided = (said: LandDecided) =>
  "error" in said ? { text: said.error, refused: true } : { text: said.decided, refused: false };

/** Evidence before the verdict: the desk's facts come first, the buttons last. */
export function LandingCard({ project, lane, theme, compact, decide, decider }: Props) {
  const [note, setNote] = useState("");
  const { busy, said, send } = useSend(decided);
  const styles = useStyles(
    theme,
    (colors) => ({
      head: { paddingHorizontal: SPACE.md, gap: SPACE.xs },
      title: { fontSize: FONT.content, fontWeight: "600" as const, color: colors.foreground },
      why: { fontSize: FONT.base, lineHeight: 20, color: colors.foregroundMuted },
      facts: { padding: SPACE.md, gap: SPACE.sm, borderRadius: RADIUS.control, backgroundColor: colors.surface2 },
      fact: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 10 },
      bullet: { paddingTop: 7 },
      factText: { flex: 1, fontSize: FONT.base, lineHeight: 20, color: colors.foreground },
      actions: { flexDirection: compact ? ("column" as const) : ("row" as const), gap: SPACE.sm },
    }),
    [compact],
  );
  const decideAs = (approve: boolean) =>
    send(
      () => decide({ project, lane: lane.id, approve, note }),
      (words) => {
        if (!words.refused) setNote("");
      },
    );
  const held = decider ? `Held while you were in the loop; the ${decider} lands lanes now` : "Ready to land";
  return (
    <DecisionFrame
      theme={theme}
      tone="you"
      meta={`${held} · ${ago(lane.landApproval.minutes)}`}
      silent="If you stay silent, it does not land. Other work goes on."
      said={said}
    >
      <View style={styles.head}>
        <Text style={styles.title}>{`${lane.id} ${lane.title} → ${lane.base ?? "its base"}`}</Text>
        {lane.landApproval.signals.length > 0 ? (
          <Text style={styles.why}>{lane.landApproval.signals.join(" ")}</Text>
        ) : null}
      </View>
      {lane.landApproval.evidence.length > 0 ? (
        <View style={styles.facts} accessibilityLabel="What the desk read of it">
          {lane.landApproval.evidence.map((fact) => (
            <View key={fact} style={styles.fact}>
              <View style={styles.bullet}>
                <Dot tone="work" theme={theme} size={5} />
              </View>
              <Text style={styles.factText}>{fact}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <TextField
        label="Note"
        placeholder="What should change? Sent to the Lead if you send it back"
        value={note}
        theme={theme}
        disabled={busy}
        onChangeText={setNote}
      />
      <View style={styles.actions}>
        <Button label="Send back" icon="Undo2" theme={theme} disabled={busy} onPress={() => decideAs(false)} />
        <Button
          label="Approve and land"
          icon="Check"
          tone="accent"
          theme={theme}
          disabled={busy}
          onPress={() => decideAs(true)}
        />
      </View>
    </DecisionFrame>
  );
}
