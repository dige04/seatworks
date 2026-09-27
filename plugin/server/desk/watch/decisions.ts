import type { Kit } from "../../catalog/kit/kit.ts";

/** A seat's thinking or saying as the brains read it, or the desk call a decision was made in. */
export type Item = { kind: "thought" | "said" | "call"; text: string };

/** A desk call a pattern is judged at: which one, and what the seat wrote in it. */
type Decision = { tool: string; text: string };

/**
 * The decisions a seat made through the desk since the watch last read it, and its words since its last decision was
 * judged: a decision is judged at the seat's next look, with the words that led to it, newest kept. Held in memory, so a
 * restart loses what was not yet judged.
 */
export class Decisions {
  private readonly kit: Kit;
  private readonly seats = new Map<string, { calls: Decision[]; words: Item[] }>();

  constructor(kit: Kit) {
    this.kit = kit;
  }

  /** A call made through the desk: kept when some pattern is judged at it, in the words the seat wrote. */
  took(seat: string, tool: string, args: unknown): void {
    if (!Object.values(this.kit.patterns).some((pattern) => pattern.tools?.includes(tool))) return;
    this.of(seat).calls.push({ tool, text: rendered(args) });
  }

  /** A look's words join the seat's since its last decision; with a decision made meanwhile, it and those words, now taken. */
  take(seat: string, words: Item[], limit: number): { calls: Decision[]; words: Item[] } | undefined {
    const entry = this.of(seat);
    entry.words = newest([...entry.words, ...words], limit);
    if (entry.calls.length === 0) return undefined;
    this.seats.delete(seat);
    return entry;
  }

  forget(seat: string): void {
    this.seats.delete(seat);
  }

  private of(seat: string): { calls: Decision[]; words: Item[] } {
    let entry = this.seats.get(seat);
    if (!entry) this.seats.set(seat, (entry = { calls: [], words: [] }));
    return entry;
  }
}

/** The latest items whose text fits in `limit` characters together. */
function newest(items: Item[], limit: number): Item[] {
  let left = limit;
  let from = items.length;
  while (from > 0 && items[from - 1]!.text.length <= left) left -= items[--from]!.text.length;
  return items.slice(from);
}

const said = (value: unknown) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);

/** A call's arguments as lines a reader can quote: each field by its name, a list one item a line. */
function rendered(value: unknown, indent = ""): string {
  if (Array.isArray(value))
    return value.map((item) => `${indent}- ${rendered(item, `${indent}  `).trimStart()}`).join("\n");
  if (typeof value === "object" && value !== null)
    return Object.entries(value)
      .filter(([, field]) => said(field))
      .map(([name, field]) =>
        typeof field === "object"
          ? `${indent}${name}:\n${rendered(field, `${indent}  `)}`
          : `${indent}${name}: ${String(field)}`,
      )
      .join("\n");
  return `${indent}${String(value)}`;
}
