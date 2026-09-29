import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsRow, SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { ReactElement } from "react";
import { Text } from "react-native";
import type { CatalogView } from "../../../shared/views.ts";
import { modelRow } from "../../model/layer.ts";

type Props = {
  catalog: CatalogView;
  role: CatalogView["roles"][number];
  /** The agent, model and thinking shown; each falls back to the first its parent offers. */
  harness: string;
  model?: string | null;
  thinking?: string | null;
  label?: string;
  hint: string;
  theme: PluginTheme;
  disabled: boolean;
  onHarness: (harness: string) => void;
  onModel: (model: string) => void;
  onThinking: (thinking: string) => void;
};

/** What a seat runs on, where it is picked ahead of a save: its agent, its model, then how hard the model thinks. */
export function seatPick(props: Props) {
  const { catalog, role, harness, model, thinking, label, hint, theme, disabled, onHarness, onModel, onThinking } =
    props;
  const spec = catalog.harnesses.find((entry) => entry.id === harness);
  const models = spec?.models ?? [];
  const row = modelRow(model ?? models[0]?.id ?? "", models);
  const rows: ReactElement[] = [
    <SettingsSelect
      key={`${role.id}-agent`}
      label={label ?? "Agent"}
      hint={hint}
      value={harness}
      options={role.harnesses.map((id) => ({
        label: catalog.harnesses.find((item) => item.id === id)?.label ?? id,
        value: id,
      }))}
      onValueChange={onHarness}
      disabled={disabled}
    />,
  ];
  if (models.length > 1 || row.stray)
    rows.push(
      // Paseo's own select, not ModelPicker: seatPick renders inside a dialog, and ModelPicker's react-native Modal
      // fights the dialog's focus trap there, which froze the whole app.
      <SettingsSelect
        key={`${role.id}-model`}
        label="Model"
        hint={row.stray ? `${row.value} is not one this agent offers. Pick one it does.` : `For the ${role.label}.`}
        value={row.value}
        options={row.options}
        onValueChange={onModel}
        disabled={disabled}
      />,
    );
  else if (models.length === 1)
    rows.push(
      <SettingsRow key={`${role.id}-model`} label="Model" hint={`${spec?.label ?? "This agent"} runs one model.`}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{models[0].label}</Text>
      </SettingsRow>,
    );
  const options = models.find((entry) => entry.id === row.value)?.thinkingOptions ?? [];
  if (options.length > 0)
    rows.push(
      <SettingsSelect
        key={`${role.id}-thinking`}
        label="Thinking"
        hint={`How hard the ${role.label}'s model thinks.`}
        value={thinking ?? options[0].id}
        options={options.map((entry) => ({ label: entry.label, value: entry.id }))}
        onValueChange={onThinking}
        disabled={disabled}
      />,
    );
  return rows;
}

type Seat = { harness?: string; model?: string | null; thinking?: string | null };

/** A seat's words: its agent, then its model and thinking. */
export function seatWords(catalog: CatalogView, seat: Seat): [string, string] {
  const spec = catalog.harnesses.find((entry) => entry.id === seat.harness);
  const model = spec?.models.find((entry) => entry.id === seat.model) ?? (seat.model ? undefined : spec?.models[0]);
  const thinking = model?.thinkingOptions?.find((entry) => entry.id === seat.thinking)?.label ?? seat.thinking;
  return [spec?.label ?? seat.harness ?? "", [model?.label ?? seat.model, thinking].filter(Boolean).join(" · ")];
}

/** A seat's agent, model and thinking in one line. */
export function seatLabel(catalog: CatalogView, seat: Seat): string {
  return seatWords(catalog, seat).filter(Boolean).join(" · ");
}
