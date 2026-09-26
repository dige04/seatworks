import { sentBy } from "../../core/sent-by.ts";
import type { Roster } from "../seats/roster.ts";

const flat = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();

/** A shorter part of a message, such as "ok" or "no", is in nearly any chat, so it stands for nothing. */
const SHORTEST = 20;

/**
 * The Human's own message in `seat`'s chat that `quote` is: the whole of it, or twenty characters and more of it.
 * Nothing when no message they wrote there holds it, as far back as the desk reads.
 */
export async function humanSaid(
  roster: Pick<Roster, "history">,
  seat: string,
  quote: string,
): Promise<string | undefined> {
  const wanted = flat(quote);
  if (!wanted) return undefined;
  const theirs = (await roster.history(seat, 200)).flatMap(({ item }) =>
    item.type === "user_message" && sentBy(item)[0] === "person" && typeof item.text === "string" ? [item.text] : [],
  );
  return theirs.find((text) => {
    const said = flat(text);
    return said === wanted || (wanted.length >= SHORTEST && said.includes(wanted));
  });
}
