import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text } from "react-native";
import { CONTROL, FONT, RADIUS, SPACE, pressState, useStyles } from "./theme.ts";

/** "accent" is the one action a card asks for; the host's SettingsAction only draws "outline". */
type ButtonTone = "accent" | "outline" | "quiet";

type Props = {
  label: string;
  theme: PluginTheme;
  tone?: ButtonTone;
  icon?: string;
  grow?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export function Button({ label, theme, tone = "outline", icon, grow, disabled, onPress }: Props) {
  const styles = useStyles(
    theme,
    (colors) => ({
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: SPACE.sm,
        minHeight: CONTROL.height,
        paddingHorizontal: SPACE.md,
        borderRadius: RADIUS.control,
        borderWidth: tone === "quiet" ? 0 : 1,
        borderColor: tone === "accent" ? colors.accent : colors.border,
        backgroundColor: tone === "accent" ? colors.accent : "transparent",
        flexGrow: grow ? 1 : 0,
      },
      label: {
        fontSize: FONT.base,
        color:
          tone === "accent" ? colors.accentForeground : tone === "quiet" ? colors.foregroundMuted : colors.foreground,
      },
    }),
    [tone, grow],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressState(disabled, pressed)]}
    >
      {icon ? <Icon name={icon} size={14} color={styles.label.color} /> : null}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}
