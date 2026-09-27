import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { Check, ProjectRow } from "../../../shared/views.ts";
import { useSeatworks } from "../../state/seatworks.ts";
import { Button } from "../kit/button.tsx";
import { PageHeader } from "../kit/header.tsx";
import { TabBar } from "../kit/tab-bar.tsx";
import { SPACE } from "../kit/theme.ts";
import { HealthTab } from "./health.tsx";
import { Home } from "./home.tsx";
import { McpTab } from "./mcp.tsx";
import { PluginPage } from "./plugin-page.tsx";
import { RulesTab } from "./rules.tsx";
import { SetupDialog } from "./setup-dialog.tsx";
import { TeamSection } from "./team.tsx";

type Tab = "team" | "rules" | "mcp" | "health";
type Page =
  { name: "home" } | { name: "plugin" } | { name: "machine"; tab: Tab } | { name: "project"; slug: string; tab: Tab };

const MACHINE = "machine";
const TABS: Record<"project" | "machine", { id: Tab; label: string }[]> = {
  project: [
    { id: "team", label: "Team" },
    { id: "rules", label: "Rules" },
    { id: "mcp", label: "MCP" },
    { id: "health", label: "Health" },
  ],
  machine: [
    { id: "team", label: "Team" },
    { id: "mcp", label: "MCP" },
    { id: "health", label: "Health" },
  ],
};

function useSavedToast(saving: boolean, saved: boolean | null) {
  const toast = useToast();
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving && saved === true) toast.show("Saved", { variant: "success" });
    wasSaving.current = saving;
  }, [saving, saved, toast]);
}

/** Seatworks' page in Paseo's sidebar: setup and settings only; the team's work is followed in the chats. */
export function SeatworksSurface({ theme, layout }: PluginSurfaceProps) {
  const [page, setPage] = useState<Page>({ name: "home" });
  const [dialog, setDialog] = useState(false);
  // Tagged with the screen they ran on and the settings they ran against.
  const [checks, setChecks] = useState<{ of: string; at: string; rows: Check[] } | null>(null);
  const project = page.name === "project" ? page.slug : undefined;
  const seatworks = useSeatworks(project);
  const { data, save, reload, saving, saved, saveError } = seatworks;
  useSavedToast(saving, saved);
  const pad = layout.compact ? SPACE.md : SPACE.xl;
  const muted = { color: theme.colors.foregroundMuted };

  const frame = (children: ReactNode) => (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: pad, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: 720, gap: SPACE.lg }}>{children}</View>
    </ScrollView>
  );

  if (data.status === "loading") return frame(<Text style={muted}>Reading the catalog and the settings.</Text>);
  if (data.status === "error")
    return frame(
      <SettingsCard>
        <SettingsAction label="Seatworks did not answer" error={data.error} actionLabel="Try again" onPress={reload} />
      </SettingsCard>,
    );

  const nameOf = (row: ProjectRow) => data.known.find((entry) => entry.root === row.root)?.name ?? row.slug;
  // Both layers, since the project's revision alone missed a machine save.
  const settledAs = `${data.revision}:${JSON.stringify(data.machine)}`;
  const problems = [
    ...(data.settingsError ? [data.settingsError] : []),
    ...(saveError ? [saveError] : []),
    ...data.team.errors,
  ];
  // Settings that could not be read are shown as empty, so editing them would save that emptiness over the file.
  const locked = saving || data.settingsError !== null;
  const trouble =
    problems.length > 0 ? (
      <SettingsSection title="Needs your attention">
        <SettingsCard>
          {problems.map((problem) => (
            <SettingsRow key={problem} label="Problem" error={problem} />
          ))}
        </SettingsCard>
      </SettingsSection>
    ) : null;
  const setup = (
    <SetupDialog
      open={dialog}
      catalog={data.catalog}
      // Off a project's page the settings read are the machine's own.
      levels={(project ? data.machine : data.values).levels}
      available={data.candidates}
      projects={data.projects}
      previewTeam={seatworks.previewTeam}
      theme={theme}
      disabled={saving}
      onOpenChange={setDialog}
      attach={seatworks.attach}
      listFolders={seatworks.listFolders}
      onAttached={(slug) => setPage({ name: "project", slug, tab: "team" })}
    />
  );

  if (page.name === "home")
    return frame(
      <>
        {trouble}
        <Home
          projects={data.projects}
          nameOf={nameOf}
          offerable={data.candidates.length}
          theme={theme}
          disabled={saving}
          onProject={(slug) => setPage({ name: "project", slug, tab: "team" })}
          onMachine={() => setPage({ name: "machine", tab: "team" })}
          onPlugin={() => setPage({ name: "plugin" })}
          onAdd={() => setDialog(true)}
        />
        {setup}
      </>,
    );
  if (page.name === "plugin") return frame(<PluginPage theme={theme} onBack={() => setPage({ name: "home" })} />);

  const here = project ? data.projects.find((entry) => entry.slug === project) : undefined;
  const layer = here ? "project" : "machine";
  const tab = page.tab;
  const detach = here
    ? () => void seatworks.detach(here.slug).then((gone) => gone && setPage({ name: "home" }))
    : undefined;
  const settings = {
    catalog: data.catalog,
    team: data.team,
    values: data.values,
    machine: data.machine,
    layer,
    theme,
    disabled: locked,
    save,
  } as const;
  return frame(
    <>
      <PageHeader
        title={here ? nameOf(here) : "Defaults for new projects"}
        subtitle={here ? here.root : "Every project that sets nothing of its own follows these."}
        theme={theme}
        onBack={() => setPage({ name: "home" })}
        backLabel="Back to Seatworks"
        action={detach ? <Button label="Detach" theme={theme} disabled={saving} onPress={detach} /> : undefined}
      />
      <TabBar
        theme={theme}
        active={tab}
        disabled={saving}
        onPick={(id) => setPage({ ...page, tab: id as Tab })}
        tabs={TABS[layer]}
      />
      {trouble}
      {tab === "team" ? <TeamSection {...settings} reload={reload} /> : null}
      {tab === "rules" && here ? (
        <RulesTab project={here.slug} name={nameOf(here)} human={data.team.hitl.on} theme={theme} />
      ) : null}
      {tab === "mcp" ? (
        <McpTab {...settings} addServer={seatworks.addServer} readServer={seatworks.readServer} />
      ) : null}
      {tab === "health" ? (
        <HealthTab
          project={project}
          theme={theme}
          checks={checks?.of === (project ?? MACHINE) ? checks.rows : null}
          stale={checks?.of === (project ?? MACHINE) && checks.at !== settledAs}
          onChecks={(rows) => setChecks({ of: project ?? MACHINE, at: settledAs, rows })}
          runDoctor={seatworks.runDoctor}
          readStatus={seatworks.readStatus}
        />
      ) : null}
    </>,
  );
}
