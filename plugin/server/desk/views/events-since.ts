import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DeskEvent } from "../store/events.ts";

export type DatedEvent = DeskEvent & { at: string };

function linesOf(path: string): string[] {
  try {
    return readFileSync(path, "utf-8").split("\n");
  } catch {
    return [];
  }
}

/**
 * The project's events at or after `from`, oldest first: `events.log` and the newest roll beside it, which stays text;
 * older rolls are packed, so a window reaching past that one starts where it does.
 */
export function eventsSince(state: string, from: number): DatedEvent[] {
  let names: string[];
  try {
    names = readdirSync(state);
  } catch {
    return [];
  }
  const rolled = names.filter((name) => /^events\.\d{8}\.log$/.test(name)).sort();
  const found: DatedEvent[] = [];
  for (const name of [...rolled.slice(-1), "events.log"])
    for (const line of linesOf(join(state, name))) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as DatedEvent;
        if (Date.parse(event.at) >= from) found.push(event);
      } catch {
        // A line cut mid-write records nothing.
      }
    }
  return found;
}
