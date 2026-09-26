/** The Upkeep section over RPC: what the plugin left behind, its updates, and what its content changed. */
import { z } from "zod";

/** `shown` is `path` as the owner reads it, from `~` under their home folder. */
const CleanItem = z.object({
  path: z.string(),
  shown: z.string(),
  kind: z.enum(["seat", "copy", "records", "snapshot"]),
  why: z.string(),
  bytes: z.number(),
  careful: z.boolean(),
  held: z.string().nullable(),
});
export type CleanItem = z.infer<typeof CleanItem>;
export const CleanView = z.object({
  items: z.array(CleanItem),
  removed: z.array(z.string()),
  failed: z.array(z.object({ path: z.string(), shown: z.string(), error: z.string() })),
});
export type CleanView = z.infer<typeof CleanView>;

export const UpdateView = z.object({
  dir: z.string(),
  version: z.string(),
  next: z.string().nullable(),
  head: z.string(),
  date: z.string().nullable(),
  fetched: z.boolean(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  behind: z.number(),
  ahead: z.number(),
  commits: z.array(z.object({ sha: z.string(), subject: z.string() })),
  installs: z.boolean(),
  paseo: z.string().nullable(),
  blocked: z.string().nullable(),
  updated: z.object({ from: z.string(), to: z.string() }).nullable(),
});
export type UpdateView = z.infer<typeof UpdateView>;

const OlderSeats = z.object({ where: z.string(), what: z.string(), detail: z.array(z.string()) });
export type OlderSeats = z.infer<typeof OlderSeats>;
export const OlderSeatsView = z.object({ version: z.string(), since: z.string(), projects: z.array(OlderSeats) });
export type OlderSeatsView = z.infer<typeof OlderSeatsView>;

const ContentChange = z.object({
  unit: z.string(),
  kind: z.enum(["guide", "record", "prompt", "skill"]),
  change: z.enum(["added", "changed", "removed"]),
  kept: z.boolean(),
});
export type ContentChange = z.infer<typeof ContentChange>;
export const ContentView = z.object({ changes: z.array(ContentChange), fault: z.string().nullable() });
export type ContentView = z.infer<typeof ContentView>;
