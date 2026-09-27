import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { SettingsSection } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { Layer, McpChoice } from "../../../shared/settings.ts";
import type { CatalogView, Parsed, TeamView } from "../../../shared/views.ts";
import { dropMcp, setMcp, sourceOf } from "../../model/layer.ts";
import { Button } from "../kit/button.tsx";
import { Chips } from "../kit/chips.tsx";
import { DisclosureList, type DisclosureItem } from "../kit/disclosure.tsx";
import { Switch } from "../kit/switch.tsx";
import { TextField } from "../kit/text-field.tsx";
import { FONT, SPACE } from "../kit/theme.ts";
import { sourceLabel } from "./source.ts";
import { McpFields } from "./mcp-fields.tsx";

type Props = {
  catalog: CatalogView;
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  theme: PluginTheme;
  disabled: boolean;
  save: (change: (values: Layer) => Layer) => Promise<boolean>;
  addServer: (text: string) => Promise<string | null>;
  readServer: (text: string) => Promise<Parsed>;
};

type Server = TeamView["mcp"][string];

const EXAMPLE = '{ "mcpServers": { "my-server": { "command": "my-server", "args": ["--stdio"] } } }';
const FILTER_FROM = 6;

/** Paste, see what Seatworks read of it, then add: the server goes to every role whose agent can reach it. */
function AddServer({
  theme,
  disabled,
  open,
  onOpenChange,
  addServer,
  readServer,
}: Pick<Props, "theme" | "disabled" | "addServer" | "readServer"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [read, setRead] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!text.trim()) return setRead(null);
    let alive = true;
    const timer = setTimeout(() => {
      readServer(text).then(
        (parsed) => alive && setRead(parsed),
        (problem: unknown) => alive && setRead({ error: String(problem) }),
      );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);
  const good = read && !("error" in read) ? read : null;
  const muted = { fontSize: FONT.small, color: theme.colors.foregroundMuted };
  return (
    <Modal title="Add an MCP server" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <Text style={muted}>
          Paste what the server's page gives you: an mcpServers block, one server, or a bare object.
        </Text>
        <TextField
          label="The server's snippet"
          placeholder={EXAMPLE}
          value={text}
          theme={theme}
          multiline
          mono
          disabled={busy}
          onChangeText={setText}
        />
        {read ? (
          <Text style={[muted, { color: good ? theme.colors.statusSuccess : theme.colors.statusDanger }]}>
            {good ? `Reads fine: ${good.label || good.id} · ${good.connect.type}` : "error" in read ? read.error : ""}
          </Text>
        ) : null}
        <Text style={muted}>It goes to every role whose agent can reach it; narrow it in the list afterwards.</Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: SPACE.sm }}>
          <Button label="Cancel" theme={theme} onPress={() => onOpenChange(false)} />
          <Button
            label={good ? `Add ${good.label || good.id}` : "Add"}
            tone="accent"
            icon="Plus"
            theme={theme}
            disabled={disabled || busy || !good}
            onPress={() => {
              setBusy(true);
              void addServer(text)
                .then((id) => {
                  if (!id) return;
                  setText("");
                  onOpenChange(false);
                })
                .finally(() => setBusy(false));
            }}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/** Every MCP server as one line; opening one shows which roles get it, its own settings and how to remove it. */
export function McpTab(props: Props) {
  const { catalog, team, values, machine, layer, theme, disabled, save } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const roleLabel = (id: string) => catalog.roles.find((role) => role.id === id)?.label ?? id;
  const transports = (role: string) =>
    catalog.harnesses.find((harness) => harness.id === team.roles[role]?.harness)?.transports ?? [];
  const source = (id: string, field: keyof McpChoice) =>
    sourceLabel(
      sourceOf(values, machine, (entry) => entry.mcp?.[id]?.[field], layer),
      layer,
    );

  const body = (id: string, server: Server) => {
    const entry = catalog.mcp.find((item) => item.id === id);
    // Only here, on this layer, does removing forget it; a machine server is switched off for this project instead.
    const addedHere = layer === "machine" || machine.mcp?.[id] === undefined;
    const options = catalog.roles
      .filter((role) => role.can.length > 0)
      .map((role) => ({
        id: role.id,
        label: role.label,
        unreachable:
          (entry !== undefined && !entry.roles.includes(role.id)) ||
          (server.connect !== null && !transports(role.id).includes(server.connect.type)),
      }));
    const unreachable = options.filter((option) => option.unreachable).map((option) => option.label);
    const muted = { fontSize: FONT.small, color: theme.colors.foregroundMuted };
    return (
      <>
        <Chips
          options={options}
          chosen={server.roles}
          theme={theme}
          disabled={disabled || !server.enabled}
          onToggle={(role, want) =>
            void save((current) =>
              setMcp(current, id, {
                roles: want ? [...new Set([...server.roles, role])] : server.roles.filter((other) => other !== role),
              }),
            )
          }
        />
        {unreachable.length > 0 ? (
          <Text style={muted}>{`${unreachable.join(", ")}: its agent cannot reach this server.`}</Text>
        ) : null}
        {entry && Object.keys(entry.settings).length > 0 ? (
          <McpFields
            entry={entry}
            current={server.settings}
            disabled={disabled}
            save={save}
            theme={theme}
            hintOf={(key) =>
              sourceLabel(
                sourceOf(values, machine, (current) => current.mcp?.[id]?.settings?.[key], layer),
                layer,
              )
            }
          />
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
          <Text style={[muted, { flex: 1 }]}>
            {server.template
              ? "It stays in the catalog; add it back whenever you want."
              : addedHere
                ? "It was added here, so removing it forgets its url and any token with it."
                : "It comes from this machine's defaults, so here it is only switched off."}
          </Text>
          <Button
            label="Remove"
            tone="quiet"
            theme={theme}
            disabled={disabled}
            onPress={() =>
              void save((current) =>
                server.template
                  ? setMcp(current, id, { removed: true, enabled: false })
                  : addedHere
                    ? dropMcp(current, id)
                    : setMcp(current, id, { enabled: false }),
              ).then(() => setOpen(null))
            }
          />
        </View>
      </>
    );
  };

  const servers: DisclosureItem[] = Object.entries(team.mcp).map(([id, server]) => ({
    id,
    title: server.label,
    dimmed: !server.enabled,
    hint: server.enabled
      ? `${server.roles.length ? server.roles.map(roleLabel).join(", ") : "No role"} · ${source(id, "roles")}`
      : `Off · ${source(id, "enabled")}`,
    trailing: (
      <Switch
        value={server.enabled}
        label={`${server.label} switched on`}
        theme={theme}
        disabled={disabled}
        onValueChange={(next) => void save((current) => setMcp(current, id, { enabled: next }))}
      />
    ),
    body: body(id, server),
  }));
  // A removed kit server keeps a line, since resolving drops it and nothing else could bring it back.
  const removed: DisclosureItem[] = catalog.mcp
    .filter((item) => !(item.id in team.mcp))
    .map((item) => ({
      id: item.id,
      title: item.label,
      dimmed: true,
      hint: "Removed · still in the catalog",
      trailing: (
        <Button
          label="Add back"
          theme={theme}
          disabled={disabled}
          onPress={() => void save((current) => setMcp(current, item.id, { removed: false }))}
        />
      ),
    }));
  const all = [...servers, ...removed];
  const needle = filter.trim().toLowerCase();
  const shown = needle ? all.filter((item) => `${item.title} ${item.hint ?? ""}`.toLowerCase().includes(needle)) : all;

  return (
    <SettingsSection
      title={`MCP servers · ${servers.length}`}
      info="Each server's switch, the roles it goes to, and its own settings."
      trailing={
        <Button label="Add server" icon="Plus" theme={theme} disabled={disabled} onPress={() => setAdding(true)} />
      }
    >
      {all.length >= FILTER_FROM ? (
        <TextField
          label="Filter servers"
          placeholder="Filter by name or role"
          value={filter}
          theme={theme}
          onChangeText={setFilter}
        />
      ) : null}
      {shown.length > 0 ? (
        <DisclosureList items={shown} open={open} theme={theme} onOpen={setOpen} />
      ) : (
        <Text style={{ fontSize: FONT.small, color: theme.colors.foregroundMuted }}>
          {all.length ? "No server matches." : "No MCP server yet. Add one."}
        </Text>
      )}
      <AddServer {...props} open={adding} onOpenChange={setAdding} />
    </SettingsSection>
  );
}
