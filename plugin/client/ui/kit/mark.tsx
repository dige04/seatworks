import type { PluginTheme } from "@getpaseo/plugin";
import { View } from "react-native";
import type { Tone } from "../../format/tone.ts";

export function toneColor(theme: PluginTheme, tone: Tone): string {
  const { statusWarning, statusSuccess, statusDanger, foregroundMuted } = theme.colors;
  return { you: statusWarning, work: foregroundMuted, wait: foregroundMuted, done: statusSuccess, fail: statusDanger }[
    tone
  ];
}

/** A waiting seat's dot is hollow, so "waits on someone" reads apart from "working" without the words. */
export function Dot({ tone, theme, size = 7 }: { tone: Tone; theme: PluginTheme; size?: number }) {
  const color = toneColor(theme, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: tone === "wait" ? 1.2 : 0,
        borderColor: color,
        backgroundColor: tone === "wait" ? "transparent" : color,
      }}
    />
  );
}
