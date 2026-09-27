import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { reportSeenRpc } from "../../../shared/rpc.ts";
import type { ReportItem, ReportSeen, ReportView } from "../../../shared/views.ts";
import { ago } from "../../format/time.ts";
import { Button } from "../kit/button.tsx";
import { Card, Rows } from "../kit/card.tsx";
import { FONT, SPACE, useStyles } from "../kit/theme.ts";
import { useSend } from "./send.ts";

/** Each part of the record in the order the Human acts on it; `hint` is shown only when the part has lines. */
const PARTS: { key: keyof Omit<ReportView, "window" | "numbers">; title: string }[] = [
  { key: "needs", title: "Needs you" },
  { key: "decided", title: "Decided for you" },
  { key: "ahead", title: "Went ahead on the recommendation · you can undo" },
  { key: "landed", title: "Landed" },
  { key: "beyond", title: "Couldn't be undone" },
  { key: "withdrawn", title: "Withdrawn by the Supervisor" },
  { key: "chat", title: "Answered in chat" },
];

const seen = (said: ReportSeen) =>
  "error" in said ? { text: said.error, refused: true } : { text: "Marked read.", refused: false };

/** Since the Human last marked it read, from the record alone: no agent writes a word of it. */
export function ReportCard({ project, report, theme }: { project: string; report: ReportView; theme: PluginTheme }) {
  const markSeen = useRpc(reportSeenRpc);
  const { busy, said, send } = useSend(seen);
  const styles = useStyles(theme, (colors) => ({
    head: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, padding: SPACE.lg },
    title: { flex: 1, fontSize: FONT.content, fontWeight: "600" as const, color: colors.foreground },
    small: { fontSize: FONT.small, color: colors.foregroundMuted },
    part: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, gap: SPACE.sm },
    item: { gap: 2 },
    itemTitle: { fontSize: FONT.base, color: colors.foreground },
    numbers: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.xl, padding: SPACE.lg },
    number: { fontSize: 16, fontWeight: "600" as const, color: colors.foreground },
    foot: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, padding: SPACE.lg },
  }));
  const span = report.window.from === null ? "the whole record" : `since you marked it read`;
  const line = (item: ReportItem) => (
    <View key={`${item.title}:${item.minutes}`} style={styles.item}>
      <Text style={styles.itemTitle}>{item.title}</Text>
      <Text style={styles.small}>{`${item.detail} · ${ago(item.minutes)}`}</Text>
    </View>
  );
  return (
    <Card theme={theme}>
      <Rows theme={theme}>
        <View style={styles.head}>
          <Icon name="Inbox" size={16} color={theme.colors.foreground} />
          <Text style={styles.title}>While you were away</Text>
          <Text style={styles.small}>{span}</Text>
        </View>
        {PARTS.filter((part) => report[part.key].length > 0).map((part) => (
          <View key={part.key} style={styles.part}>
            <Text style={styles.small}>{part.title}</Text>
            {report[part.key].map(line)}
          </View>
        ))}
        {report.numbers.length > 0 ? (
          <View style={styles.numbers}>
            {report.numbers.map((row) => (
              <View key={row.title}>
                <Text style={styles.number}>{row.value}</Text>
                <Text style={styles.small}>{row.title}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.foot}>
          <Text style={[styles.small, { flex: 1, color: said?.refused ? theme.colors.statusWarning : undefined }]}>
            {said?.text ?? "The next report starts where this one ends."}
          </Text>
          <Button
            label="Mark read"
            theme={theme}
            disabled={busy}
            onPress={() => send(() => markSeen({ project, until: report.window.until }))}
          />
        </View>
      </Rows>
    </Card>
  );
}
