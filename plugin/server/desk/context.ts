import type { RoleSpec } from "../catalog/kit/kit.ts";
import type { Project } from "./project/project.ts";

export type ToolRequest = {
  id: string;
  agent: string;
  role: string;
  tool: string;
  args: Record<string, unknown>;
  cwd: string;
  at: number;
};
export type ToolReply = { ok: boolean; text: string };
export type Args = Record<string, unknown>;
export type Caller = { id: string; role: RoleSpec; title: string; project: Project };

export const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const strs = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];
/** Only the fields the call names, as text or a list: an amendment changes what it is given and nothing else. */
export const given = (args: Args, texts: string[], lists: string[]): Record<string, string | string[]> => {
  const fields: [string, string | string[]][] = [
    ...texts.map((key): [string, string] => [key, str(args[key])]),
    ...lists.map((key): [string, string[]] => [key, strs(args[key])]),
  ];
  return Object.fromEntries(fields.filter(([key]) => args[key] !== undefined));
};
/** A brief's lists kept apart: what must hold, what was chosen and may be questioned, what nobody knows yet. */
export const BRIEF_LISTS = ["constraints", "choices", "unknowns"] as const;
export const briefLists = (args: Args): Partial<Record<(typeof BRIEF_LISTS)[number], string[]>> =>
  Object.fromEntries(
    BRIEF_LISTS.flatMap((key) => {
      const items = strs(args[key]);
      return items.length > 0 ? [[key, items]] : [];
    }),
  );
export const ok = (text: string): ToolReply => ({ ok: true, text });
export const no = (text: string): ToolReply => ({ ok: false, text });
