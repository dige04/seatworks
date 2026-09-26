import { clip } from "../../core/text.ts";
import type { Ask } from "../../domain/ask.ts";

export const list = (items: string[] | undefined, empty = "none") =>
  items && items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : empty;
export const firstLine = (text: string) =>
  text
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim() ?? "";

/** A person's note as a sentence: theirs often ends in a full stop already, and one more reads as a typo. */
export const ended = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/**
 * Every kind of letter the desk mails: a letter's key starts with its kind, as does the id Paseo shows for its message.
 */
type Kind =
  | "answer"
  | "answeredFor"
  | "ask"
  | "amended"
  | "baseconflict"
  | "basemoved"
  | "beside"
  | "canland"
  | "case"
  | "closed"
  | "detour"
  | "done"
  | "failed"
  | "gone"
  | "halfopen"
  | "held"
  | "hold"
  | "humananswered"
  | "humanwrote"
  | "incident"
  | "land"
  | "landback"
  | "landheld"
  | "lanebeside"
  | "lapsed"
  | "later"
  | "leadgone"
  | "merge"
  | "message"
  | "notstarted"
  | "nudge"
  | "opened"
  | "pending"
  | "permission"
  | "permitted"
  | "reconcile"
  | "report"
  | "resumed"
  | "rework"
  | "settled"
  | "settling"
  | "silent"
  | "started"
  | "unanswered";

/**
 * A letter to a seat: a second one with its key is the same letter, and `wakes` false is word that asks nothing of its
 * reader now, which rides along with the next letter that does.
 */
export type Letter = { key: string; text: string; wakes?: false };

/**
 * Keyed by its kind and the ids that make it this letter, never where it is posted; it ends with what it asks, `next`.
 */
export const mail = (kind: Kind, ids: (string | number)[], text: string, next: string): Letter => ({
  key: [kind, ...ids].join(":"),
  text: `${text}\n\nNext: ${next}`,
});

export const fyi = (letter: Letter): Letter => ({ ...letter, wakes: false });

export function mailbox(items: string[], open: Ask[]): string {
  const head = items.length === 1 ? "" : `${items.length} messages\n\n`;
  const body = items.join("\n\n---\n\n");
  if (open.length === 0) return `${head}${body}`;
  const asks = open.map((ask) => `- ${ask.id} (${ask.kind}): ${clip(firstLine(ask.text), 160)}`).join("\n");
  return `${head}${body}\n\n---\n\nOpen asks waiting on you:\n${asks}`;
}
