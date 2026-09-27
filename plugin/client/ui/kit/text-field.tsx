import type { PluginTheme } from "@getpaseo/plugin";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { FONT, RADIUS, SPACE, useStyles } from "./theme.ts";

type Props = {
  value: string;
  placeholder: string;
  label: string;
  theme: PluginTheme;
  disabled?: boolean;
  multiline?: boolean;
  mono?: boolean;
  onChangeText: (text: string) => void;
};

/** A bare field for inside a card, drawn as Paseo draws its question card's "Other…" box. */
export function TextField({ value, placeholder, label, theme, disabled, multiline, mono, onChangeText }: Props) {
  const styles = useStyles(
    theme,
    (colors) => ({
      field: {
        minHeight: multiline ? 120 : 40,
        paddingHorizontal: SPACE.md,
        paddingVertical: multiline ? SPACE.sm : 10,
        borderRadius: RADIUS.card,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        color: colors.foreground,
        fontSize: mono ? FONT.small : FONT.base,
        fontFamily: mono ? "monospace" : undefined,
      },
    }),
    [multiline, mono],
  );
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      editable={!disabled}
      multiline={multiline}
      textAlignVertical={multiline ? "top" : "center"}
      onChangeText={onChangeText}
      style={styles.field}
    />
  );
}
