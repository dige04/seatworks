import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useMemo } from "react";
import { Text, View } from "react-native";
import { Dot, Heading, Rule } from "./bits.tsx";
import type { WatchJudge, WatchView } from "../../shared/flow-views.ts";
import { ago } from "../format/time.ts";
import { incidentLines, judgeWords } from "../format/watch.ts";

function useStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 12,
        paddingHorizontal: 18,
        paddingVertical: 12,
      },
      labels: { flex: 1, gap: 4, minWidth: 0 },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      dot: { paddingTop: 5 },
    }),
    [theme],
  );
}

function Section({ title, children, theme }: { title: string; children: ReactNode; theme: PluginTheme }) {
  return (
    <>
      <Heading text={title} theme={theme} />
      <SettingsCard>
        <View>{children}</View>
      </SettingsCard>
    </>
  );
}

/** Trouble nobody is mailed about, shown whatever the watch is doing: a refused call is the harness's, not the watch's. */
function Trouble({ watch, theme }: { watch: WatchView; theme: PluginTheme }) {
  const styles = useStyles(theme);
  if (watch.trouble.length === 0) return null;
  return (
    <Section title="Not from the watch" theme={theme}>
      {watch.trouble.map((entry, index) => (
        <View key={`${entry.kind}-${index}`}>
          {index > 0 ? <Rule theme={theme} /> : null}
          <View style={styles.row}>
            <View style={styles.dot}>
              <Dot color={theme.colors.statusWarning} />
            </View>
            <View style={styles.labels}>
              <Text style={styles.title}>
                {entry.kind === "call.malformed" ? "A call never reached the desk" : entry.kind}
              </Text>
              <Text style={styles.hint}>{entry.detail}</Text>
            </View>
            <Text style={styles.hint}>{ago(entry.minutes)}</Text>
          </View>
        </View>
      ))}
    </Section>
  );
}

function JudgeLine({ judge, judgeRole, theme }: { judge: WatchJudge; judgeRole: string; theme: PluginTheme }) {
  const styles = useStyles(theme);
  const words = judgeWords(judge, judgeRole);
  const tone = {
    success: theme.colors.statusSuccess,
    warning: theme.colors.statusWarning,
    muted: theme.colors.foregroundMuted,
  }[words.tone];
  return (
    <Section title="The watch" theme={theme}>
      <View style={styles.row}>
        <View style={styles.dot}>
          <Dot color={tone} />
        </View>
        <View style={styles.labels}>
          <Text style={styles.title}>{words.title}</Text>
          <Text style={styles.hint}>{words.hint}</Text>
        </View>
        {judge.minutes !== null ? <Text style={styles.hint}>{ago(judge.minutes)}</Text> : null}
      </View>
    </Section>
  );
}

type WatchProps = { watch: WatchView; supervisor: string; judgeRole: string; theme: PluginTheme };

/** Who answers the watch, then how many incidents stand where: what W found is its own, so the Human sees counts, not the cases. */
export function WatchCard({ watch, supervisor, judgeRole, theme }: WatchProps) {
  const styles = useStyles(theme);
  const lines = incidentLines(watch.incidents, supervisor);
  const { told, held, recorded } = watch.incidents;
  return (
    <View style={{ gap: 10 }}>
      <JudgeLine judge={watch.judge} judgeRole={judgeRole} theme={theme} />
      {lines.length > 0 ? (
        <Section title={`Incidents · ${told + held + recorded} not yet marked`} theme={theme}>
          {lines.map((line, index) => (
            <View key={line}>
              {index > 0 ? <Rule theme={theme} /> : null}
              <View style={[styles.row, { alignItems: "center" }]}>
                <Text style={styles.title}>{line}</Text>
              </View>
            </View>
          ))}
        </Section>
      ) : null}
      <Trouble watch={watch} theme={theme} />
    </View>
  );
}
