import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LEVELS, type Layer, type RoleChoice } from "../../../shared/settings.ts";
import type { CatalogView, TeamView } from "../../../shared/views.ts";
import { nextSeat, setLevelSeat } from "../../model/layer.ts";
import { Button } from "../kit/button.tsx";
import { Card } from "../kit/card.tsx";
import { FONT, RADIUS, SPACE, pressState, useStyles } from "../kit/theme.ts";
import { seatPick, seatWords } from "./seat-pick.tsx";

type Props = {
  catalog: CatalogView;
  team: TeamView;
  values: Layer;
  theme: PluginTheme;
  disabled: boolean;
  save: (change: (values: Layer) => Layer) => Promise<boolean>;
};

type Role = CatalogView["roles"][number];
type Seat = Pick<RoleChoice, "harness" | "model" | "thinking">;
type Cell = { level: (typeof LEVELS)[number]; role: Role };

/** One cell's agent, model and thinking, picked apart from the page and saved whole, or handed back to Defaults. */
function CellDialog({
  cell,
  catalog,
  team,
  values,
  theme,
  disabled,
  save,
  onClose,
}: Props & { cell: Cell; onClose: () => void }) {
  const own = values.levels?.[cell.level.id]?.[cell.role.id];
  const defaults = team.roles[cell.role.id];
  const [seat, setSeat] = useState<Seat>(
    own ?? {
      harness: defaults?.harness ?? cell.role.defaults.harness,
      ...(defaults?.model ? { model: defaults.model } : {}),
      ...(defaults?.thinking ? { thinking: defaults.thinking } : {}),
    },
  );
  const pick = (change: Seat) => setSeat((current) => nextSeat(current, change));
  const put = (next: Seat | null) =>
    void save((current) => setLevelSeat(current, cell.level.id, cell.role.id, next)).then((kept) => {
      if (kept) onClose();
    });
  const styles = useStyles(theme, () => ({
    footer: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, paddingTop: SPACE.sm },
    spacer: { flex: 1 },
  }));
  return (
    <Modal title={`${cell.level.label} · ${cell.role.label}`} open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <SettingsCard>
          {seatPick({
            catalog,
            role: cell.role,
            harness: seat.harness ?? "",
            model: seat.model,
            thinking: seat.thinking,
            hint: `Runs every ${cell.role.label} turn in a project set up from ${cell.level.label}.`,
            theme,
            disabled,
            onHarness: (harness) => pick({ harness }),
            onModel: (model) => pick({ model }),
            onThinking: (thinking) => pick({ thinking }),
          })}
        </SettingsCard>
        <View style={styles.footer}>
          <Button label="Use Defaults" theme={theme} disabled={disabled || !own} onPress={() => put(null)} />
          <View style={styles.spacer} />
          <Button label="Cancel" theme={theme} onPress={onClose} />
          <Button
            label="Save"
            tone="accent"
            theme={theme}
            disabled={disabled || JSON.stringify(seat) === JSON.stringify(own)}
            onPress={() => put(seat)}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/** Cheap, Balanced and Max side by side, a role a row; a cell opens its seat, and one left empty follows Defaults. */
export function LevelsSection(props: Props) {
  const { catalog, values, theme, disabled } = props;
  const [open, setOpen] = useState<Cell | null>(null);
  const styles = useStyles(theme, (colors) => ({
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingLeft: SPACE.lg,
      paddingRight: SPACE.sm,
      paddingVertical: 6,
    },
    head: { paddingVertical: 10 },
    rule: { borderTopWidth: 1, borderTopColor: colors.border },
    role: { flex: 0.8, fontSize: FONT.base, color: colors.foreground },
    cell: { flex: 1, paddingHorizontal: SPACE.sm, paddingVertical: 6, borderRadius: RADIUS.control, gap: 2 },
    hovered: { backgroundColor: colors.surface2 },
    title: { fontSize: FONT.base, color: colors.foreground },
    muted: { fontSize: FONT.small, color: colors.foregroundMuted },
    column: { flex: 1, paddingHorizontal: SPACE.sm },
    foot: { fontSize: FONT.small, color: colors.foregroundMuted, paddingHorizontal: SPACE.xs },
  }));
  return (
    <SettingsSection
      title="Levels"
      info="Pick one when adding a project. The project copies it, so changing a level later moves no project."
    >
      <Card theme={theme}>
        <View style={[styles.row, styles.head]}>
          <View style={{ flex: 0.8 }} />
          {LEVELS.map((level) => (
            <Text key={level.id} style={[styles.muted, styles.column]}>
              {level.label}
            </Text>
          ))}
        </View>
        {catalog.roles.map((role) => (
          <View key={role.id} style={[styles.row, styles.rule]}>
            <Text style={styles.role} numberOfLines={1}>
              {role.label}
            </Text>
            {LEVELS.map((level) => {
              const seat = values.levels?.[level.id]?.[role.id];
              const [agent, rest] = seat ? seatWords(catalog, seat) : ["—", ""];
              return (
                <Pressable
                  key={level.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${level.label}, ${role.label}: ${seat ? `${agent} ${rest}` : "follows Defaults"}`}
                  disabled={disabled}
                  style={(state) => [
                    styles.cell,
                    (state as { hovered?: boolean }).hovered ? styles.hovered : null,
                    pressState(disabled, state.pressed),
                  ]}
                  onPress={() => setOpen({ level, role })}
                >
                  <Text style={seat ? styles.title : styles.muted} numberOfLines={1}>
                    {agent}
                  </Text>
                  {rest ? (
                    <Text style={styles.muted} numberOfLines={1}>
                      {rest}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </Card>
      <Text style={styles.foot}>— follows Defaults. Tap a cell to choose its agent, model and thinking.</Text>
      {open ? (
        <CellDialog key={`${open.level.id}:${open.role.id}`} {...props} cell={open} onClose={() => setOpen(null)} />
      ) : null}
    </SettingsSection>
  );
}
