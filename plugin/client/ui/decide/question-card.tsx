import type { PluginTheme, RpcInput } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { questionAnswerRpc } from "../../../shared/rpc.ts";
import type { FlowQuestion } from "../../../shared/flow-views.ts";
import type { QuestionAnswered } from "../../../shared/views.ts";
import { ago } from "../../format/time.ts";
import { Button } from "../kit/button.tsx";
import { TextField } from "../kit/text-field.tsx";
import { FONT, RADIUS, SPACE, useStyles } from "../kit/theme.ts";
import { DecisionFrame } from "./frame.tsx";
import { useSend } from "./send.ts";

type Answer = (input: RpcInput<typeof questionAnswerRpc>) => Promise<QuestionAnswered>;

type Props = {
  project: string;
  question: FlowQuestion;
  theme: PluginTheme;
  compact: boolean;
  answer: Answer;
  /** Whoever decides in the Human's place while they are out of the loop; their word still reaches it. */
  decider?: string;
};

const answered = (said: QuestionAnswered) =>
  "error" in said ? { text: said.error, refused: true } : { text: said.answered, refused: false };

/** The Supervisor's question, drawn as Paseo draws an agent's own question so the Human meets one kind of card. */
export function QuestionCard({ project, question, theme, compact, answer, decider }: Props) {
  const [choice, setChoice] = useState(question.recommend);
  const [note, setNote] = useState("");
  const { busy, said, send } = useSend(answered);
  const styles = useStyles(
    theme,
    (colors) => ({
      question: { paddingHorizontal: SPACE.md, fontSize: FONT.base, lineHeight: 22, color: colors.foreground },
      options: { gap: SPACE.xs },
      option: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: SPACE.sm,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm,
        borderRadius: RADIUS.control,
      },
      chosen: { backgroundColor: colors.surface2 },
      radio: {
        width: 18,
        height: 18,
        marginTop: 2,
        borderRadius: 9,
        borderWidth: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
      words: { flex: 1, gap: SPACE.xs },
      label: { fontSize: FONT.base, lineHeight: 22 },
      effect: { fontSize: FONT.base, lineHeight: 20, color: colors.foregroundMuted },
      actions: { flexDirection: compact ? ("column" as const) : ("row" as const), gap: SPACE.sm },
    }),
    [compact],
  );
  const submit = (picked: string) =>
    send(
      () => answer({ project, question: question.id, choice: picked, note }),
      (words) => {
        if (!words.refused) setNote("");
      },
    );
  const where = question.lane ? ` · ${question.lane}` : "";
  const place = decider ? `Asked while you were in the loop; the ${decider} decides it now` : "Supervisor asks";
  return (
    <DecisionFrame
      theme={theme}
      tone="you"
      meta={`${place}${where} · ${ago(question.minutes)}`}
      silent={`If you stay silent: ${question.ifSilent}`}
      said={said}
    >
      <Text style={styles.question}>{question.question}</Text>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={question.question}>
        {question.options.map((option) => {
          const on = option.label === choice;
          const recommended = option.label === question.recommend;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: busy }}
              accessibilityLabel={option.label}
              disabled={busy}
              onPress={() => setChoice(option.label)}
              style={[styles.option, on ? styles.chosen : null]}
            >
              <View style={[styles.radio, { borderColor: on ? theme.colors.accent : theme.colors.foregroundMuted }]}>
                {on ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.words}>
                <Text style={[styles.label, { color: on ? theme.colors.foreground : theme.colors.foregroundMuted }]}>
                  {recommended ? `${option.label} (Recommended)` : option.label}
                </Text>
                <Text style={styles.effect}>{recommended ? `${option.effect} ${question.reason}` : option.effect}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <TextField
        label="Note for the Supervisor"
        placeholder="Note for the Supervisor (optional)"
        value={note}
        theme={theme}
        disabled={busy}
        onChangeText={setNote}
      />
      <View style={styles.actions}>
        <Button label="Decline" icon="X" theme={theme} disabled={busy} onPress={() => submit("decline")} />
        <Button
          label="Submit"
          icon="Check"
          tone="accent"
          theme={theme}
          disabled={busy}
          onPress={() => submit(choice)}
        />
        <Button label="Withdraw" tone="quiet" theme={theme} disabled={busy} onPress={() => submit("cancel")} />
      </View>
    </DecisionFrame>
  );
}
