import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Heading } from "./bits.tsx";
import type { Check } from "../../shared/views.ts";
import { message } from "../format/error.ts";

type Props = {
  project?: string;
  theme: PluginTheme;
  checks: Check[] | null;
  stale: boolean;
  onChecks: (checks: Check[]) => void;
  runDoctor: () => Promise<Check[]>;
  readStatus: (slug: string) => Promise<{ text: string; error?: string }>;
};

const GROUPS: [Check["group"], string][] = [
  ["machine", "This machine"],
  ["agent", "Agents"],
  ["server", "Servers"],
];

export function HealthSection({ project, theme, checks, stale, onChecks, runDoctor, readStatus }: Props) {
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  // Busy and error per action, so a failed Status read is not shown beside Doctor.
  const [busy, setBusy] = useState<"doctor" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const styles = useMemo(
    () => ({
      report: { padding: 12, borderRadius: 8, backgroundColor: theme.colors.surface2 },
      text: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
      good: { color: theme.colors.statusSuccess, fontSize: 12, fontWeight: "500" as const },
      bad: { color: theme.colors.statusDanger, fontSize: 12, fontWeight: "500" as const },
    }),
    [theme],
  );

  const run = async (which: "doctor" | "status", work: () => Promise<void>): Promise<void> => {
    setBusy(which);
    const fail = which === "doctor" ? setError : setStatusError;
    fail(null);
    try {
      await work();
    } catch (problem) {
      fail(message(problem));
    } finally {
      setBusy(null);
    }
  };

  const all = checks ?? [];
  const failing = all.filter((check) => !check.ok);
  // Past tense and only for the settings it ran against, so an old report is not read as current.
  const summary =
    all.length === 0
      ? "Agents, tools and servers."
      : stale
        ? `${all.length - failing.length} of ${all.length} passed before the last save. Run it again.`
        : failing.length === 0
          ? `All ${all.length} pass. Everything the team needs is here.`
          : `${all.length - failing.length} of ${all.length} pass. ${failing.length} needs work.`;

  return (
    <SettingsSection title="Health" info="What this machine still needs before the team can work.">
      <SettingsCard>
        <SettingsAction
          label="Doctor"
          hint={summary}
          error={error}
          actionLabel={busy === "doctor" ? "Checking" : "Run"}
          disabled={busy !== null}
          onPress={() => void run("doctor", async () => onChecks(await runDoctor()))}
        />
        {GROUPS.map(([group, title]) => {
          const mine = all.filter((check) => check.group === group);
          if (mine.length === 0) return null;
          return (
            <View key={group}>
              <Heading text={title} theme={theme} />
              {mine.map((check) => (
                <SettingsRow key={check.id} label={check.id} hint={check.detail}>
                  <Text style={check.ok ? styles.good : styles.bad}>{check.ok ? "OK" : "Needs work"}</Text>
                </SettingsRow>
              ))}
            </View>
          );
        })}
      </SettingsCard>
      {project ? (
        <SettingsCard>
          <SettingsAction
            label="Status"
            hint="Lanes, tasks and open asks right now."
            error={statusError}
            actionLabel={busy === "status" ? "Reading" : "Read"}
            disabled={busy !== null}
            onPress={() =>
              void run("status", async () => {
                const answer = await readStatus(project);
                // A refusal is not a report.
                setStatusError(answer.error ?? null);
                setStatus(answer.error ? "" : answer.text);
              })
            }
          />
          {status ? (
            <View style={styles.report}>
              <Text style={styles.text}>{status.trim()}</Text>
            </View>
          ) : null}
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
