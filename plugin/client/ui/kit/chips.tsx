import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { FONT, RADIUS, SPACE, pressState, useStyles } from "./theme.ts";

/** `unreachable` is an option that exists but cannot be chosen, shown dashed so the reason can sit beside it. */
type ChipOption = { id: string; label: string; unreachable?: boolean };

type Props = {
  options: ChipOption[];
  chosen: string[];
  theme: PluginTheme;
  disabled?: boolean;
  onToggle: (id: string, on: boolean) => void;
};

export function Chips({ options, chosen, theme, disabled, onToggle }: Props) {
  const styles = useStyles(theme, (colors) => ({
    row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
    chip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE.xs,
      minHeight: 28,
      paddingHorizontal: 10,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    on: { backgroundColor: colors.surface2, borderColor: colors.foregroundMuted },
    unreachable: { borderStyle: "dashed" as const, opacity: 0.55 },
    text: { fontSize: FONT.small, color: colors.foregroundMuted },
    textOn: { color: colors.foreground },
  }));
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const on = chosen.includes(option.id) && !option.unreachable;
        const locked = disabled || option.unreachable;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: Boolean(locked) }}
            accessibilityLabel={option.label}
            disabled={locked}
            style={({ pressed }) => [
              styles.chip,
              on ? styles.on : null,
              option.unreachable ? styles.unreachable : pressState(disabled, pressed),
            ]}
            onPress={() => onToggle(option.id, !on)}
          >
            {on ? <Icon name="Check" size={12} color={theme.colors.foreground} /> : null}
            <Text style={[styles.text, on ? styles.textOn : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
