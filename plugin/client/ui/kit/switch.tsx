import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, View } from "react-native";
import { pressState } from "./theme.ts";

/** Paseo's switch (34×20, 16 thumb) for a row of our own; the host's comes only inside a SettingsSwitch row. */
export function Switch({
  value,
  label,
  theme,
  disabled,
  onValueChange,
}: {
  value: boolean;
  label: string;
  theme: PluginTheme;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [
        {
          width: 34,
          height: 20,
          padding: 2,
          borderRadius: 10,
          alignItems: value ? "flex-end" : "flex-start",
          backgroundColor: value ? theme.colors.accent : theme.colors.surface2,
        },
        pressState(disabled, pressed),
      ]}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: value ? theme.colors.accentForeground : theme.colors.foregroundMuted,
        }}
      />
    </Pressable>
  );
}
