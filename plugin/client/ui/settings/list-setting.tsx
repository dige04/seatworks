import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SettingSpec } from "../../../shared/views.ts";
import { Button } from "../kit/button.tsx";
import { TextField } from "../kit/text-field.tsx";
import { FONT, RADIUS, SPACE, useStyles } from "../kit/theme.ts";

type Item = string | number;

type Props = {
  spec: SettingSpec;
  items: Item[];
  hint: string;
  theme: PluginTheme;
  disabled: boolean;
  put: (items: Item[]) => void;
};

/** A typed item, or why it is not one: a list of numbers takes whole numbers only, and none twice. */
function itemOf(text: string, spec: SettingSpec, items: Item[]): { item: Item } | { wrong: string } {
  const typed = text.trim();
  if (!typed) return { wrong: "Type one first." };
  const item = spec.of === "number" ? Number(typed) : typed;
  if (spec.of === "number" && !Number.isInteger(item)) return { wrong: "That needs a whole number." };
  return items.includes(item) ? { wrong: "It is already there." } : { item };
}

/** A setting that holds several values in order, the first tried first: each one removable, one more added below. */
export function ListSetting({ spec, items, hint, theme, disabled, put }: Props) {
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState<string | null>(null);
  const styles = useStyles(theme, (colors) => ({
    box: { padding: SPACE.lg, gap: SPACE.sm },
    label: { fontSize: FONT.base, color: colors.foreground },
    hint: { fontSize: FONT.small, color: colors.foregroundMuted },
    chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
    chip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      minHeight: 28,
      paddingLeft: 10,
      paddingRight: 6,
      borderRadius: RADIUS.control,
      backgroundColor: colors.surface2,
    },
    value: { fontSize: FONT.small, fontFamily: "monospace", color: colors.foreground },
    add: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm },
  }));
  const add = () => {
    const read = itemOf(typed, spec, items);
    if ("wrong" in read) {
      setWrong(read.wrong);
      return;
    }
    setWrong(null);
    setTyped("");
    put([...items, read.item]);
  };
  return (
    <View style={styles.box}>
      <Text style={styles.label}>{spec.label}</Text>
      <Text style={styles.hint}>{wrong ?? `${hint} · tried in this order`}</Text>
      <View style={styles.chips}>
        {items.map((item) => (
          <View key={String(item)} style={styles.chip}>
            <Text style={styles.value}>{String(item)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${String(item)}`}
              disabled={disabled || items.length === 1}
              onPress={() => put(items.filter((other) => other !== item))}
            >
              <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.add}>
        <View style={{ flex: 1 }}>
          <TextField
            label={`Add to ${spec.label}`}
            placeholder="Add one"
            value={typed}
            theme={theme}
            disabled={disabled}
            onChangeText={setTyped}
          />
        </View>
        <Button label="Add" icon="Plus" theme={theme} disabled={disabled || !typed.trim()} onPress={add} />
      </View>
    </View>
  );
}
