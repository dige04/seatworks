import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Card } from "../kit/card.tsx";
import type { Tone } from "../../format/tone.ts";
import { Dot } from "../kit/mark.tsx";
import { FONT, SPACE, useStyles } from "../kit/theme.ts";
import type { Said } from "./send.ts";

type Props = {
  theme: PluginTheme;
  tone: Tone;
  meta: string;
  silent?: string;
  said: Said | null;
  children: ReactNode;
};

/** A decision's card: who asks and since when, the body, what silence does, then the desk's word once sent. */
export function DecisionFrame({ theme, tone, meta, silent, said, children }: Props) {
  const styles = useStyles(theme, (colors) => ({
    body: { padding: SPACE.md, gap: SPACE.md },
    meta: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: SPACE.md },
    small: { fontSize: FONT.small, color: colors.foregroundMuted, flexShrink: 1 },
    foot: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: SPACE.xs },
  }));
  return (
    <Card theme={theme}>
      <View style={styles.body}>
        <View style={styles.meta}>
          <Dot tone={tone} theme={theme} size={6} />
          <Text style={styles.small}>{meta}</Text>
        </View>
        {children}
        {silent ? (
          <View style={styles.foot}>
            <Icon name="Clock" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.small}>{silent}</Text>
          </View>
        ) : null}
        {said ? (
          <Text
            style={[styles.small, { color: said.refused ? theme.colors.statusWarning : theme.colors.foregroundMuted }]}
          >
            {said.text}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/** A settled decision, kept in the chat as one line under the same id: who decided what, and when. */
export function SettledLine({
  theme,
  tone,
  text,
  when,
}: {
  theme: PluginTheme;
  tone: Tone;
  text: string;
  when: string;
}) {
  const styles = useStyles(theme, (colors) => ({
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, padding: SPACE.md },
    text: { flex: 1, fontSize: FONT.base, color: colors.foregroundMuted },
    when: { fontSize: FONT.small, color: colors.foregroundMuted },
  }));
  return (
    <Card theme={theme}>
      <View style={styles.row}>
        <Dot tone={tone} theme={theme} />
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
        <Text style={styles.when}>{when}</Text>
      </View>
    </Card>
  );
}
