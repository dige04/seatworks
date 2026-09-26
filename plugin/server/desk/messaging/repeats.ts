import { loadIncidents } from "../store/incidents.ts";

/**
 * Why text for `seat` may not go to it: it names an incident about that seat still open, or repeats the watch's words for it.
 * What the seat itself said or ran is the sender's to name; a short quote is a word the sender would use anyway.
 */
export function repeatsIncident(state: string, seat: string | undefined, ...texts: string[]): string | undefined {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const said = flat(texts.join("\n"));
  const hit = Object.values(loadIncidents(state).items).find(
    (incident) =>
      incident.open &&
      incident.seat === seat &&
      (new RegExp(`\\b${incident.id}\\b`, "i").test(said) ||
        (!incident.theirs && incident.quote.length >= 20 && said.includes(flat(incident.quote)))),
  );
  return (
    hit &&
    `That repeats incident ${hit.id} about the seat it goes to. Say what you read in its record, in your own words: a seat told of the watch works to the watch.`
  );
}
