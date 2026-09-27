import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsInput, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { type ReactElement, useState } from "react";
import type { Layer, SettingValue } from "../../../shared/settings.ts";
import type { CatalogView, SettingSpec } from "../../../shared/views.ts";
import { setMcp } from "../../model/layer.ts";
import { Rows } from "../kit/card.tsx";
import { ListSetting } from "./list-setting.tsx";

type Save = (change: (values: Layer) => Layer) => Promise<boolean>;

type Field = {
  key: string;
  spec: SettingSpec;
  value: SettingValue | undefined;
  hint: string;
  disabled: boolean;
  theme: PluginTheme;
  put: (value: SettingValue) => void;
  type: (text: string) => void;
};

/** One control per kind of setting a server's spec declares; a new kind is a new entry here, never a branch elsewhere. */
const FIELDS: Record<SettingSpec["type"], (field: Field) => ReactElement> = {
  boolean: ({ key, spec, value, hint, disabled, put }) => (
    <SettingsSwitch
      key={key}
      label={spec.label}
      hint={hint}
      value={Boolean(value ?? spec.default ?? false)}
      onValueChange={put}
      disabled={disabled}
    />
  ),
  number: ({ key, spec, value, hint, disabled, type }) => (
    <SettingsInput
      key={key}
      label={spec.label}
      hint={hint}
      initialValue={String(value ?? spec.default ?? "")}
      onChangeText={type}
      disabled={disabled}
    />
  ),
  list: ({ key, spec, value, hint, disabled, theme, put }) => (
    <ListSetting
      key={key}
      spec={spec}
      items={Array.isArray(value) ? value : Array.isArray(spec.default) ? spec.default : []}
      hint={hint}
      theme={theme}
      disabled={disabled}
      put={put}
    />
  ),
  string: ({ key, spec, value, hint, disabled, type }) => (
    <SettingsInput
      key={key}
      label={spec.label}
      hint={hint}
      initialValue={String(value ?? spec.default ?? "")}
      onChangeText={type}
      disabled={disabled}
    />
  ),
};

/** A server's own settings, drawn from what its spec declares: a server that declares none shows nothing. */
export function McpFields({
  entry,
  current,
  disabled,
  save,
  hintOf,
  theme,
}: {
  entry: CatalogView["mcp"][number];
  current: Record<string, SettingValue>;
  disabled: boolean;
  save: Save;
  hintOf: (key: string) => string;
  theme: PluginTheme;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const typed = (key: string, spec: SettingSpec): SettingValue => {
    const text = draft[key] ?? String(current[key] ?? "");
    return spec.type === "number" ? Number(text) : text;
  };
  const edited = Object.keys(draft).filter((key) => draft[key] !== String(current[key] ?? ""));
  // An emptied field is not zero, though `Number("")` is.
  const wrong = edited.some(
    (key) => entry.settings[key]?.type === "number" && (!draft[key].trim() || !Number.isFinite(Number(draft[key]))),
  );
  const rows = Object.entries(entry.settings).map(([key, spec]) =>
    FIELDS[spec.type]({
      key,
      spec,
      value: current[key],
      hint: hintOf(key),
      disabled,
      theme,
      put: (value) => void save((values) => setMcp(values, entry.id, { settings: { [key]: value } })),
      type: (text) => setDraft((last) => ({ ...last, [key]: text })),
    }),
  );
  return (
    <Rows theme={theme}>
      {rows}
      {edited.length > 0 ? (
        <SettingsAction
          label={wrong ? "That needs a number" : "Unsaved change"}
          error={wrong ? "That needs a number" : null}
          actionLabel="Save"
          disabled={disabled || wrong}
          onPress={() => {
            const settings = Object.fromEntries(edited.map((key) => [key, typed(key, entry.settings[key])]));
            // Cleared only once kept, so a refused save keeps the unsaved row.
            void save((values) => setMcp(values, entry.id, { settings })).then((kept) => {
              if (kept) setDraft({});
            });
          }}
        />
      ) : null}
    </Rows>
  );
}
