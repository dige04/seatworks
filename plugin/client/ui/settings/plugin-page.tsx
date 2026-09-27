import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { cleanRpc, olderSeatsRpc, updateRpc } from "../../../shared/rpc.ts";
import type { CleanItem, CleanView, OlderSeatsView, UpdateView } from "../../../shared/upkeep-views.ts";
import { message } from "../../format/error.ts";
import { Button } from "../kit/button.tsx";
import { PageHeader } from "../kit/header.tsx";
import { FONT, SPACE } from "../kit/theme.ts";

type Busy = "update" | "clean" | null;

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

/** Switched on at first: everything a scan finds free, but what needs care or is kept for a reason. */
const picked = (items: CleanItem[]) =>
  new Set(items.filter((item) => !item.careful && !item.held).map((item) => item.path));

function versionLine(view: UpdateView | null): { title: string; state: string } {
  if (!view) return { title: "Seatworks", state: "Reading this copy's version." };
  const now = view.version || view.head;
  if (view.updated)
    return { title: `Seatworks ${now}`, state: `Updated from ${view.updated.from}. The plugin is reloading.` };
  if (view.behind > 0) {
    const title = `${now} → ${view.next && view.next !== now ? view.next : plural(view.behind, "commit")}`;
    return { title, state: view.blocked ?? `${plural(view.behind, "new commit")} on ${view.upstream ?? "its remote"}` };
  }
  if (view.blocked) return { title: `${now} · ${view.head}`, state: view.blocked };
  return {
    title: `${now} · ${view.head}`,
    state: view.fetched ? "Up to date." : `Check asks ${view.upstream ?? "its remote"} for anything newer.`,
  };
}

/** The plugin on this machine: its version and update, seats still on an older one, and what nothing uses any more. */
export function PluginPage({ theme, onBack }: { theme: PluginTheme; onBack: () => void }) {
  const update = useRpc(updateRpc);
  const older = useRpc(olderSeatsRpc);
  const clean = useRpc(cleanRpc);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<UpdateView | null>(null);
  const [seats, setSeats] = useState<OlderSeatsView | null>(null);
  const [scan, setScan] = useState<CleanView | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

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
    void update({ apply: false, fetch: false }).then(setVersion, (problem: unknown) => setError(message(problem)));
    void older({}).then(setSeats, (problem: unknown) => setError(message(problem)));
    // Once per visit: an update reloads the plugin, which is what the owner needs next.
  }, []);

  const canUpdate = Boolean(version && !version.blocked && !version.updated && version.behind > 0);
  const line = versionLine(version);
  const items = scan?.items ?? [];
  const picks = items.filter((item) => chosen.has(item.path));
  const freed = picks.reduce((sum, item) => sum + item.bytes, 0);
  const muted = { fontSize: FONT.small, color: theme.colors.foregroundMuted };

  const rescan = () =>
    void run("clean", async () => {
      const next = await clean(picks.length ? { remove: picks.map((item) => item.path) } : {});
      setScan(next);
      setChosen(picks.length ? new Set() : picked(next.items));
      if (next.failed.length) setError(next.failed.map((fail) => `${fail.shown}: ${fail.error}`).join("\n"));
    });

  return (
    <>
      <PageHeader title="Plugin" subtitle="Seatworks on this machine" theme={theme} onBack={onBack} />
      <SettingsSection title="Version">
        <SettingsCard>
          <SettingsAction
            label={line.title}
            hint={line.state}
            error={error}
            actionLabel={busy === "update" ? (canUpdate ? "Updating" : "Checking") : canUpdate ? "Update" : "Check"}
            disabled={busy !== null || Boolean(version?.updated)}
            onPress={() => void run("update", async () => setVersion(await update({ apply: canUpdate })))}
          />
        </SettingsCard>
      </SettingsSection>
      {seats && seats.projects.length > 0 ? (
        <SettingsSection title="Needs a look">
          <SettingsCard>
            {seats.projects.map((project) => (
              <SettingsRow
                key={project.where}
                label={`${project.where}: ${project.what}`}
                hint={[
                  ...project.detail,
                  "They keep working as they are; seats started from now on use this version.",
                ].join(" ")}
              />
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      <SettingsSection
        title="Clean up"
        trailing={
          <Button
            label={busy === "clean" && !picks.length ? "Scanning" : scan ? "Scan again" : "Scan"}
            theme={theme}
            disabled={busy !== null}
            onPress={() => {
              setChosen(new Set());
              void run("clean", async () => {
                const next = await clean({});
                setScan(next);
                setChosen(picked(next.items));
              });
            }}
          />
        }
      >
        <SettingsCard>
          <SettingsRow
            label={
              !scan
                ? "Folders nothing uses any more"
                : items.length
                  ? `Found ${plural(items.length, "thing")}`
                  : "Nothing left behind"
            }
            hint={
              !scan
                ? "Scan to see what the plugin left behind."
                : `${size(items.reduce((sum, item) => sum + item.bytes, 0))} · switched on means it will be removed`
            }
          />
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
          {items.length > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.lg }}>
              <Text style={[muted, { flex: 1 }]}>
                Removed for good; a working copy with changes in it is never touched.
              </Text>
              <Button
                label={busy === "clean" ? "Removing" : `Remove ${picks.length} · ${size(freed)}`}
                tone="accent"
                theme={theme}
                disabled={busy !== null || picks.length === 0}
                onPress={rescan}
              />
            </View>
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
