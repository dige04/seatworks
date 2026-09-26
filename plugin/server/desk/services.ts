import { z } from "zod";
import type { Agents } from "./seats/agents.ts";
import type { DeskBase } from "./base.ts";
import type { Caller, ToolReply } from "./context.ts";
import type { MergeQueue } from "./tasks/merge-queue.ts";
import type { OwnCopy } from "./copies/own-copy.ts";
import type { Roster } from "./seats/roster.ts";
import type { Slots } from "./copies/slots.ts";
import type { Teardowns } from "./seats/teardown.ts";
import type { Watcher } from "./watch/watcher.ts";

/** The desk's services; a function takes only those it uses. */
export type DeskServices = DeskBase & {
  roster: Roster;
  slots: Slots;
  ownCopy: OwnCopy;
  teardowns: Teardowns;
  agents: Agents;
  merges: MergeQueue;
  watcher: Watcher;
};

/**
 * A tool as the desk serves it: `input` is what its handler reads, and it must be the schema the calling seat was shown;
 * `speaks` when a call to it says something to another seat, which a call that only reads does not.
 */
export type ToolDef = {
  name: string;
  input: z.ZodObject;
  speaks?: true;
  handle(desk: DeskServices, caller: Caller, input: Record<string, unknown>): Promise<ToolReply>;
};

export function defineTool<Input extends z.ZodObject>(tool: {
  name: string;
  input: Input;
  speaks?: true;
  handle(desk: DeskServices, caller: Caller, input: z.infer<Input>): Promise<ToolReply>;
}): ToolDef {
  return tool;
}
