import type { PluginTheme } from "@getpaseo/plugin";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Button } from "../kit/button.tsx";
import { LEVELS, type Layer, type LevelId } from "../../../shared/settings.ts";
import type { CatalogView, Folders, ProjectRow, TeamView } from "../../../shared/views.ts";
import type { PaseoProject } from "../../state/seatworks.ts";
import { message } from "../../format/error.ts";
import { setRole } from "../../model/layer.ts";
import { Chips } from "../kit/chips.tsx";
import { DisclosureList } from "../kit/disclosure.tsx";
import { seatLabel, seatPick } from "./seat-pick.tsx";

type Props = {
  open: boolean;
  catalog: CatalogView;
  /** The machine's levels, one of which may be picked to start from. */
  levels: Layer["levels"];
  available: PaseoProject[];
  projects: ProjectRow[];
  previewTeam: (root: string, values: Layer) => Promise<TeamView | { error: string }>;
  theme: PluginTheme;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  attach: (root: string, values: Layer) => Promise<{ slug: string; note?: string } | null>;
  listFolders: (path?: string) => Promise<Folders | { error: string }>;
  onAttached: (slug: string) => void;
};

export function SetupDialog({
  open,
  catalog,
  levels,
  available,
  projects,
  previewTeam,
  theme,
  disabled,
  onOpenChange,
  attach,
  listFolders,
  onAttached,
}: Props) {
  const toast = useToast();
  const [root, setRootPath] = useState("");
  const [draft, setDraft] = useState<Layer>({});
  const [role, setActiveRole] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelId | null>(null);
  const [browsing, setBrowsing] = useState<Folders | null>(null);
  const [picking, setPicking] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  // The team the draft makes of the target, as the desk resolves it over what the target holds already.
  const [preview, setPreview] = useState<{ root: string; team: TeamView } | null>(null);
  const attached = projects.map((entry) => entry.root);
  const styles = useMemo(
    () => ({
      footer: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingTop: 8 },
      summary: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
      pair: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    }),
    [theme],
  );

  const path = root.trim();
  const team = preview?.root === path ? preview.team : undefined;
  const harnessOf = (id: string) => team?.roles[id]?.harness ?? "";
  const setSeat = (id: string, choice: Parameters<typeof setRole>[2], newHarness = false) => {
    setLevel(null);
    setDraft((current) => setRole(current, id, choice, newHarness));
  };
  // A level replaces what was picked by hand; one put down again leaves every seat to Defaults.
  const pickLevel = (id: LevelId | null) => {
    setLevel(id);
    setDraft(id && levels?.[id] ? { roles: { ...levels[id] } } : {});
  };

  useEffect(() => {
    if (!open || !path) return;
    let stale = false;
    void previewTeam(path, draft).then((read) => {
      if (!stale && !("error" in read)) setPreview({ root: path, team: read });
    });
    return () => {
      stale = true;
    };
  }, [open, path, draft, previewTeam]);

  const close = () => {
    setDraft({});
    setRootPath("");
    setActiveRole(null);
    setLevel(null);
    setBrowsing(null);
    setPicking(false);
    setTrouble(null);
    setPreview(null);
    onOpenChange(false);
  };

  const browse = (where?: string) =>
    void listFolders(where)
      .then((answer) => {
        if ("error" in answer) {
          setTrouble(answer.error);
          return;
        }
        setTrouble(null);
        setPicking(false);
        setBrowsing(answer);
      })
      .catch((error: unknown) => setTrouble(message(error)));

  const summary = () => {
    if (trouble) return trouble;
    if (!path) return "Choose a repository to start.";
    return `Writes only this project's team into Paseo.`;
  };

  return (
    <Modal title="Add a project" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <SettingsCard>
          <SettingsRow label="Repository" hint={path || "No folder chosen yet."}>
            <View style={styles.pair}>
              <Button label="Browse" theme={theme} disabled={disabled} onPress={() => browse(path || undefined)} />
              <Button
                label="Pick"
                theme={theme}
                disabled={disabled}
                onPress={() => {
                  setBrowsing(null);
                  setPicking(true);
                }}
              />
            </View>
          </SettingsRow>
        </SettingsCard>
        {browsing ? (
          <SettingsSection
            title={browsing.path}
            info={
              browsing.root
                ? `Inside the repository ${browsing.root}, which is what would be set up.`
                : browsing.repository
                  ? "This folder is a repository."
                  : "Open a folder, or go up."
            }
          >
            <SettingsCard>
              <SettingsAction
                label={browsing.repository ? "Use this folder" : "Use it anyway"}
                // Attaching a folder registers its repository, so compare against that root, not the folder.
                hint={
                  attached.includes(browsing.root ?? browsing.path)
                    ? "Already set up. Going on from here changes the agents; everything else it holds is kept."
                    : browsing.root
                      ? `Setting this up sets up ${browsing.root}.`
                      : browsing.repository
                        ? "A git repository."
                        : "Seatworks will register it as its own project."
                }
                actionLabel="Use"
                disabled={disabled}
                onPress={() => {
                  setRootPath(browsing.root ?? browsing.path);
                  setBrowsing(null);
                }}
              />
              {browsing.parent ? (
                <SettingsAction
                  label="Up one folder"
                  hint={browsing.parent}
                  actionLabel="Open"
                  disabled={disabled}
                  onPress={() => browse(browsing.parent ?? undefined)}
                />
              ) : null}
              {browsing.folders.map((folder) => (
                <SettingsAction
                  key={folder.path}
                  label={folder.name}
                  hint={folder.repository ? "repository" : ""}
                  actionLabel="Open"
                  disabled={disabled}
                  onPress={() => browse(folder.path)}
                />
              ))}
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {picking ? (
          <SettingsSection title="Projects Paseo knows" info="These have no Seatworks settings yet.">
            <SettingsCard>
              {available.length === 0 ? (
                <SettingsRow label="Nothing to pick" hint="Every project Paseo knows is already set up." />
              ) : (
                available.map((entry) => (
                  <SettingsAction
                    key={entry.root}
                    label={entry.name}
                    hint={entry.root}
                    actionLabel="Choose"
                    disabled={disabled}
                    onPress={() => {
                      setRootPath(entry.root);
                      setPicking(false);
                    }}
                  />
                ))
              )}
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {path ? (
          <SettingsSection
            title="Seats"
            info="Start from a level, or open a seat to change it before the project is set up."
          >
            <Chips
              theme={theme}
              disabled={disabled}
              options={LEVELS.map((entry) => ({ ...entry, unreachable: !levels?.[entry.id] }))}
              chosen={level ? [level] : []}
              onToggle={(id, on) => pickLevel(on ? (id as LevelId) : null)}
            />
            {LEVELS.some((entry) => levels?.[entry.id]) ? null : (
              <Text style={styles.summary}>No levels yet: set Cheap, Balanced or Max in This machine › Defaults.</Text>
            )}
            <DisclosureList
              theme={theme}
              open={role}
              onOpen={setActiveRole}
              items={catalog.roles.map((entry) => ({
                id: entry.id,
                title: entry.label,
                hint: team?.roles[entry.id] ? seatLabel(catalog, team.roles[entry.id]) : "",
                flush: true,
                body: (
                  <SettingsCard>
                    {seatPick({
                      catalog,
                      role: entry,
                      harness: harnessOf(entry.id),
                      model: team?.roles[entry.id]?.model,
                      thinking: team?.roles[entry.id]?.thinking,
                      hint: `Runs every ${entry.label} turn in this repository.`,
                      theme,
                      disabled,
                      onHarness: (next) => setSeat(entry.id, { harness: next }, true),
                      onModel: (next) => setSeat(entry.id, { model: next }),
                      onThinking: (next) => setSeat(entry.id, { thinking: next }),
                    })}
                  </SettingsCard>
                ),
              }))}
            />
            {attached.includes(path) ? (
              <Text style={styles.summary}>
                Already set up: its rules, servers and attention stay as they are; only the agents above change.
              </Text>
            ) : null}
          </SettingsSection>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.summary} numberOfLines={1}>
            {summary()}
          </Text>
          <Button label="Cancel" theme={theme} onPress={close} />
          <Button
            label={path ? `Set up ${path.split("/").pop()}` : "Set up"}
            tone="accent"
            theme={theme}
            disabled={disabled || !path}
            onPress={() =>
              void attach(path, draft).then((added) => {
                if (!added) return;
                if (added.note) toast.show(added.note, { variant: "info" });
                close();
                onAttached(added.slug);
              })
            }
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
