import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsSection } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import type { ProjectRow } from "../../../shared/views.ts";
import { Button } from "../kit/button.tsx";
import { DisclosureList } from "../kit/disclosure.tsx";
import { PageHeader } from "../kit/header.tsx";
import { FONT } from "../kit/theme.ts";

type Props = {
  projects: ProjectRow[];
  nameOf: (project: ProjectRow) => string;
  offerable: number;
  theme: PluginTheme;
  disabled: boolean;
  onProject: (slug: string) => void;
  onMachine: () => void;
  onPlugin: () => void;
  onAdd: () => void;
};

/** Where projects are managed and nothing else: what the team is doing lives in the Supervisor's chat. */
export function Home({ projects, nameOf, offerable, theme, disabled, onProject, onMachine, onPlugin, onAdd }: Props) {
  return (
    <>
      <PageHeader
        title="Seatworks"
        subtitle="Set a project up once, then work in its Supervisor chat."
        theme={theme}
        action={<Button label="Add project" tone="accent" theme={theme} disabled={disabled} onPress={onAdd} />}
      />
      <SettingsSection title="Projects">
        {projects.length > 0 ? (
          <DisclosureList
            theme={theme}
            open={null}
            onOpen={() => undefined}
            items={projects.map((project) => ({
              id: project.slug,
              title: nameOf(project),
              hint: project.root,
              onPress: () => onProject(project.slug),
            }))}
          />
        ) : (
          <Text style={{ fontSize: FONT.small, color: theme.colors.foregroundMuted }}>
            {offerable > 0
              ? `No project uses Seatworks yet; ${offerable} repositor${offerable === 1 ? "y" : "ies"} Paseo knows can be added.`
              : "No project uses Seatworks yet. Add any repository on this machine."}
          </Text>
        )}
      </SettingsSection>
      <SettingsSection title="This machine">
        <DisclosureList
          theme={theme}
          open={null}
          onOpen={() => undefined}
          items={[
            {
              id: "machine",
              title: "Defaults for new projects",
              hint: "Every project that sets nothing of its own follows these",
              onPress: onMachine,
            },
            { id: "plugin", title: "Plugin", hint: "Version, updates and clean up", onPress: onPlugin },
          ]}
        />
      </SettingsSection>
    </>
  );
}
