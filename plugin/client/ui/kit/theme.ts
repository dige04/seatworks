import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";

/** Paseo's own spacing, radius and type steps (app/styles/theme.ts), so plugin controls sit flush with the host's. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const RADIUS = { control: 6, card: 8, pill: 16 } as const;
export const FONT = { small: 12, base: 14, content: 15 } as const;
export const CONTROL = { height: 32, pressed: 0.85, faded: 0.5 } as const;

/** Styles built once per theme; `make` reads only the theme and what the caller closes over in `deps`. */
export function useStyles<T>(theme: PluginTheme, make: (colors: PluginTheme["colors"]) => T, deps: unknown[] = []): T {
  return useMemo(() => make(theme.colors), [theme, ...deps]);
}

/** How a press looks: faded while it cannot be pressed, dimmed while held. */
export const pressState = (disabled: boolean | undefined, pressed: boolean) =>
  disabled ? { opacity: CONTROL.faded } : pressed ? { opacity: CONTROL.pressed } : null;
