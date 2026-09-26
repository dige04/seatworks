import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { cleanRpc, contentRpc, olderSeatsRpc, updateRpc } from "../../shared/rpc.ts";
import type {
  CleanItem,
  CleanView,
  ContentChange,
  ContentView,
  OlderSeatsView,
  UpdateView,
} from "../../shared/upkeep-views.ts";
import { Button, Dot } from "./bits.tsx";
import { message } from "../format/error.ts";

type Busy = "update" | "read" | "clean" | "content" | null;

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const KIND: Record<CleanItem["kind"], string> = {
  seat: "Seat folder",
  copy: "Working copy",
  records: "Project records",
  snapshot: "Copy of guides or skills",
};

/** Picked unless it holds something of the owner's, or cannot go at all. */
const picked = (items: CleanItem[]) =>
  new Set(items.filter((item) => !item.careful && !item.held).map((item) => item.path));

/** `prompts/LEAD.md` reads "Lead prompt", `skills/supervisor/grilling` "grilling skill". */
function unitName(change: ContentChange): string {
  const last = change.unit.split("/").pop() ?? change.unit;
  if (change.kind === "prompt")
    return `${last
      .replace(/\.md$/, "")
      .toLowerCase()
      .replace(/^./, (first) => first.toUpperCase())} prompt`;
  if (change.kind === "skill") return `${last} skill`;
  return last;
}

/** The version line: what runs, and what the branch it follows has. */
function versionLine(view: UpdateView | null): { title: string; state: string } {
  if (!view) return { title: "Seatworks", state: "Reading this copy's version." };
  const now = view.version || view.head;
  if (view.updated)
    return { title: `Seatworks ${now}`, state: `Updated from ${view.updated.from}. The plugin is reloading.` };
  if (view.behind > 0) {
    const title = `Seatworks ${now} → ${view.next && view.next !== now ? view.next : plural(view.behind, "commit")}`;
    return { title, state: view.blocked ?? plural(view.behind, "new commit") };
  }
  if (view.blocked) return { title: `Seatworks ${now} · ${view.head}`, state: view.blocked };
  return {
    title: `Seatworks ${now} · ${view.head}`,
    state: view.fetched ? "Up to date." : `Check asks ${view.upstream ?? "its remote"} for anything newer.`,
  };
}

export function UpkeepSection({ theme }: { theme: PluginTheme }) {
  const update = useRpc(updateRpc);
  const older = useRpc(olderSeatsRpc);
  const content = useRpc(contentRpc);
  const clean = useRpc(cleanRpc);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<UpdateView | null>(null);
  const [seats, setSeats] = useState<OlderSeatsView | null>(null);
  const [changed, setChanged] = useState<ContentView | null>(null);
  const [cleaned, setCleaned] = useState<CleanView | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const styles = useMemo(
    () => ({
      scroll: { maxHeight: 280 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderColor: theme.colors.border,
      },
      words: { flex: 1, gap: 2 },
      label: { color: theme.colors.foreground, fontSize: 13 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
      actions: { flexDirection: "row" as const, gap: 6 },
    }),
    [theme],
  );

  const run = async (which: Exclude<Busy, null>, work: () => Promise<void>) => {
    setBusy(which);
    setError(null);
    try {
      await work();
    } catch (problem) {
      setError(message(problem));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void update({ apply: false, fetch: false }).then(setUpdated, (problem: unknown) => setError(message(problem)));
    void run("read", async () => {
      const [started, kit] = await Promise.all([older({}), content({})]);
      setSeats(started);
      setChanged(kit);
    });
    // Once per mount: an update reloads the plugin, and this is what the owner needs next.
  }, []);

  const canUpdate = Boolean(updated && !updated.blocked && !updated.updated && updated.behind > 0);
  const line = versionLine(updated);
  const seen = (units: string[]) => void run("content", async () => setChanged(await content({ seen: units })));

  // Only what needs the owner, one row each.
  const rows: ReactNode[] = [];
  const row = (key: string, warn: boolean, label: string, detail: string | null, actions: ReactNode) =>
    rows.push(
      <View key={key} style={styles.row}>
        <Dot color={warn ? theme.colors.statusWarning : theme.colors.border} />
        <View style={styles.words}>
          <Text style={styles.label}>{label}</Text>
          {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        </View>
        <View style={styles.actions}>{actions}</View>
      </View>,
    );
  if (changed?.fault) row("content-fault", true, changed.fault, null, null);
  const changes = changed?.changes ?? [];
  for (const change of changes.filter((entry) => entry.kind !== "guide" && entry.kind !== "record")) {
    const name = unitName(change);
    row(
      change.unit,
      false,
      change.change === "added"
        ? `New ${name}`
        : change.change === "removed"
          ? `${name} was removed`
          : `${name} changed`,
      change.kept ? "Your own copy is the one in use." : null,
      <Button label="OK" theme={theme} disabled={busy !== null} onPress={() => seen([change.unit])} />,
    );
  }
  const told = changes.filter((entry) => entry.kind === "guide" || entry.kind === "record");
  if (told.length > 0) {
    row(
      "told",
      false,
      "Guides and records changed",
      told.map((entry) => entry.unit).join(", "),
      <Button
        label="Got it"
        theme={theme}
        disabled={busy !== null}
        onPress={() => seen(told.map((entry) => entry.unit))}
      />,
    );
  }
  for (const project of seats?.projects ?? [])
    row(`older:${project.where}`, true, `${project.where}: ${project.what}`, project.detail.join(" "), null);

  const items = cleaned?.items ?? [];
  const picks = items.filter((item) => chosen.has(item.path));
  const found = items.reduce((sum, item) => sum + item.bytes, 0);

  return (
    <SettingsSection title="Plugin">
      <SettingsCard>
        <SettingsAction
          label={line.title}
          hint={line.state}
          error={error}
          actionLabel={busy === "update" ? (canUpdate ? "Updating" : "Checking") : canUpdate ? "Update" : "Check"}
          disabled={busy !== null || Boolean(updated?.updated)}
          onPress={() => void run("update", async () => setUpdated(await update({ apply: canUpdate })))}
        />
        {rows.length > 0 ? (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <View>{rows}</View>
          </ScrollView>
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <SettingsAction
          label="Clean up"
          hint={
            !cleaned
              ? "Folders nothing uses any more."
              : items.length
                ? `${plural(items.length, "item")} · ${size(found)}`
                : "Nothing left behind."
          }
          actionLabel={
            busy === "clean"
              ? picks.length
                ? "Removing"
                : "Scanning"
              : picks.length
                ? `Remove ${picks.length}`
                : cleaned
                  ? "Scan again"
                  : "Scan"
          }
          disabled={busy !== null}
          onPress={() =>
            void run("clean", async () => {
              const next = await clean(picks.length ? { remove: picks.map((item) => item.path) } : {});
              setCleaned(next);
              setChosen(picks.length ? new Set() : picked(next.items));
              if (next.failed.length) setError(next.failed.map((fail) => `${fail.shown}: ${fail.error}`).join("\n"));
            })
          }
        />
        {items.length > 0 ? (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <View>
              {items.map((item) => (
                <SettingsSwitch
                  key={item.path}
                  label={`${KIND[item.kind]} · ${item.shown}`}
                  hint={`${item.held ? `Kept: ${item.held}` : item.why} · ${size(item.bytes)}`}
                  value={chosen.has(item.path)}
                  disabled={busy !== null || item.held !== null}
                  onValueChange={(on) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (on) next.add(item.path);
                      else next.delete(item.path);
                      return next;
                    })
                  }
                />
              ))}
            </View>
          </ScrollView>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
