import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { Check } from "../../../shared/views.ts";
import { message } from "../../format/error.ts";
import { Button } from "../kit/button.tsx";
import { DisclosureList } from "../kit/disclosure.tsx";
import { FONT, RADIUS, SPACE, useStyles } from "../kit/theme.ts";

type Props = {
  project?: string;
  theme: PluginTheme;
  checks: Check[] | null;
  stale: boolean;
  onChecks: (checks: Check[]) => void;
  runDoctor: () => Promise<Check[]>;
  readStatus: (slug: string) => Promise<{ text: string; error?: string }>;
};

const GROUP: Record<Check["group"], string> = { machine: "This machine", agent: "Agents", server: "Servers" };

function CheckRow({ check, theme }: { check: Check; theme: PluginTheme }) {
  const styles = useStyles(theme, (colors) => ({
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.md, padding: SPACE.lg },
    words: { flex: 1, gap: SPACE.xs },
    title: { fontSize: FONT.base, color: colors.foreground },
    hint: { fontSize: FONT.small, color: colors.foregroundMuted },
  }));
  return (
    <View style={styles.row}>
      <Icon
        name={check.ok ? "Check" : "TriangleAlert"}
        size={16}
        color={check.ok ? theme.colors.statusSuccess : theme.colors.statusDanger}
      />
      <View style={styles.words}>
        <Text style={styles.title}>{check.id}</Text>
        <Text style={styles.hint}>{`${GROUP[check.group]} · ${check.detail}`}</Text>
      </View>
    </View>
  );
}

/** Checks run on their own when the tab opens and after a save; what needs work comes first. */
export function HealthTab({ project, theme, checks, stale, onChecks, runDoctor, readStatus }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setError(null);
    runDoctor()
      .then(onChecks)
      .catch((problem: unknown) => setError(message(problem)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (!checks || stale) run();
  }, [stale]);
  useEffect(() => {
    if (open !== "details" || !project || status !== null) return;
    readStatus(project).then(
      (answer) => setStatus(answer.error ?? answer.text.trim()),
      (problem: unknown) => setStatus(message(problem)),
    );
  }, [open, project]);

  const all = checks ?? [];
  const failing = all.filter((check) => !check.ok);
  const passing = all.filter((check) => check.ok);
  const muted = { fontSize: FONT.small, color: theme.colors.foregroundMuted };
  const rerun = <Button label={busy ? "Checking" : "Check again"} theme={theme} disabled={busy} onPress={run} />;
  return (
    <>
      {failing.length > 0 ? (
        <SettingsSection title={`${failing.length} need${failing.length === 1 ? "s" : ""} fixing`} trailing={rerun}>
          <SettingsCard>
            {failing.map((check) => (
              <CheckRow key={check.id} check={check} theme={theme} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      <SettingsSection
        title={checks ? `Working · ${passing.length} of ${all.length}` : "Checking"}
        trailing={failing.length === 0 ? rerun : undefined}
      >
        {error ? <Text style={[muted, { color: theme.colors.statusDanger }]}>{error}</Text> : null}
        {passing.length > 0 ? (
          <SettingsCard>
            {passing.map((check) => (
              <CheckRow key={check.id} check={check} theme={theme} />
            ))}
          </SettingsCard>
        ) : (
          <Text style={muted}>{busy ? "Asking each agent, tool and server." : "Nothing passed yet."}</Text>
        )}
      </SettingsSection>
      {project ? (
        <SettingsSection title="For a bug report">
          <DisclosureList
            theme={theme}
            open={open}
            onOpen={setOpen}
            items={[
              {
                id: "details",
                title: "Lanes, tasks and open asks, as the desk has them",
                body: (
                  <View
                    style={{ padding: SPACE.md, borderRadius: RADIUS.card, backgroundColor: theme.colors.surface2 }}
                  >
                    <Text style={[muted, { lineHeight: 18 }]}>{status ?? "Reading."}</Text>
                  </View>
                ),
              },
            ]}
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
