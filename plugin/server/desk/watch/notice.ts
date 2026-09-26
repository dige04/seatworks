import { recordEvent } from "../store/event-log.ts";
import { seatOf } from "../../catalog/kit/roles.ts";
import { type Finding, type Incident, deliveryOf, tell, unheard } from "../../domain/incident.ts";
import { closeSeat, forget, settledAsNoise, sight } from "../store/incidents.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { laneOfLead, taskOfPeer } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { errorText } from "../../core/errors.ts";
import { watchLetters } from "../letters/watch-letters.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";

export type Noticed = { id: string; provider: string; title?: string | null };

export type Placed = { where: string; lane?: Lane; task?: Task };

/** Where a seat works, as a letter names it: the Peer on a task, the Lead of a lane, or the seat by its title. */
export function placeOf(project: Project, seat: Noticed): Placed {
  try {
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, seat.id);
    const lane = task ? ledger.lanes[task.lane] : laneOfLead(ledger, seat.id);
    if (task) return { where: `the Peer on ${task.id} (${task.title})`, lane, task };
    if (lane) return { where: `the Lead of ${lane.id} (${lane.title})`, lane };
  } catch {
    // A ledger that cannot be read leaves the seat named by its title alone.
  }
  return { where: seat.title ? `${seat.title} (${seat.id})` : seat.id };
}

/** What the watch saw of a seat: the findings that open or sight incidents, held or told as each one's signal says. */
export async function notice(
  services: DeskServices,
  project: Project,
  seat: Noticed,
  findings: Finding[],
  now = Date.now(),
): Promise<{ opened: Incident[]; sent: string[]; place: Placed }> {
  const place = placeOf(project, seat);
  if (findings.length === 0) return { opened: [], sent: [], place };
  for (const finding of findings) {
    recordEvent(project, {
      kind: "watch.finding",
      agent: seat.id,
      finding: finding.kind,
      level: finding.level,
      quote: finding.quote,
      facts: finding.facts,
    });
  }
  let booked: { opened: Incident[]; sending: Incident[] };
  try {
    booked = openIncidents(services, project, seat, place, findings, now);
  } catch (error) {
    await pageUnbooked(services, project, seat, place, findings, errorText(error));
    throw error;
  }
  const { opened, sending } = booked;
  const sent = sending.length > 0 ? await deliver(services, project, seat, place, sending, now) : [];
  return { opened, sent, place };
}

/** A page reaches whoever supervises whatever the book can keep: with none to read, it goes unbooked. */
async function pageUnbooked(
  { roster, mail, teamFor }: Pick<DeskServices, "roster" | "mail" | "teamFor">,
  project: Project,
  seat: Noticed,
  place: Placed,
  findings: Finding[],
  fault: string,
): Promise<void> {
  const pages = findings.filter((finding) => finding.level === "page");
  if (pages.length === 0) return;
  const to = await roster.supervisorFor(project, place.lane?.opener).catch(() => undefined);
  if (!to || to === seat.id) return;
  const human = teamFor(project).hitl.on;
  for (const page of pages) await mail.post(to, watchLetters.unbooked(page, place, seat.id, fault, { human }));
}

/** Opens or sights an incident for each finding not settled as noise, and tells what is not told yet. */
function openIncidents(
  { kit, incidents, teamFor }: Pick<DeskServices, "kit" | "incidents" | "teamFor">,
  project: Project,
  seat: Noticed,
  place: Placed,
  findings: Finding[],
  now: number,
): { opened: Incident[]; sending: Incident[] } {
  const kept = teamFor(project).attention.incidentsKept;
  return incidents.transact(project, (book) => {
    const opened: Incident[] = [];
    const sending: Incident[] = [];
    for (const finding of findings) {
      const sighting = {
        seat: seat.id,
        provider: seat.provider,
        where: place.where,
        lane: place.lane?.id,
        task: place.task?.id,
        kind: finding.kind,
        level: finding.level,
        quote: finding.quote,
        facts: finding.facts,
        ...(finding.theirs && { theirs: finding.theirs }),
      };
      if (settledAsNoise(book, sighting, now, Object.hasOwn(kit.patterns, finding.kind))) continue;
      const { incident, opened: isNew } = sight(book, sighting, now);
      if (deliveryOf(incident) !== "told" && tell(incident, now)) sending.push({ ...incident });
      if (isNew) {
        recordEvent(project, {
          kind: "incident.open",
          id: incident.id,
          agent: seat.id,
          finding: incident.kind,
          level: incident.level,
          held: incident.held ?? null,
        });
        opened.push({ ...incident });
      }
    }
    forget(book, kept);
    return { opened, sending };
  });
}

/**
 * Tells whoever supervises the seat's lane each incident, pages first: W's only edge is to the Supervisor, never to a Lead
 * and never to the seat it watched. With nobody seated to tell, each is held until somebody sits down.
 */
async function deliver(
  services: DeskServices,
  project: Project,
  seat: Noticed,
  place: Placed,
  sending: Incident[],
  now: number,
): Promise<string[]> {
  const { kit, incidents, mail, roster, teamFor } = services;
  const steers = seatOf(kit, seat.provider)?.harness.steers === true;
  const human = teamFor(project).hitl.on;
  let to: string | undefined;
  try {
    to = await roster.supervisorFor(project, place.lane?.opener);
  } catch (error) {
    recordEvent(project, { kind: "incident.lookup-failed", error: errorText(error) });
  }
  if (!to || to === seat.id) {
    unheardAll(
      incidents,
      project,
      sending.map((sent) => sent.id),
      now,
    );
    for (const sent of sending) recordEvent(project, { kind: "incident.held", id: sent.id, held: "nobody" });
    return [];
  }
  const pagesFirst = [...sending].sort((a, b) => Number(a.level !== "page") - Number(b.level !== "page"));
  const told: string[] = [];
  const failed: string[] = [];
  for (const incident of pagesFirst) {
    try {
      await mail.post(to, watchLetters.incident(incident, place, { steers, human }));
      told.push(incident.id);
    } catch (error) {
      failed.push(incident.id);
      recordEvent(project, { kind: "incident.post-failed", id: incident.id, error: errorText(error) });
    }
  }
  // A letter that never left told nobody: the incident waits, as for nobody seated, and a later round tells it.
  if (failed.length > 0) unheardAll(incidents, project, failed, now);
  recordEvent(project, { kind: "incident.told", ids: told, to });
  return told;
}

function unheardAll(incidents: DeskServices["incidents"], project: Project, ids: string[], now: number): void {
  incidents.transact(project, (book) => {
    for (const id of ids) {
      const incident = book.items[id];
      if (incident?.told === now) unheard(incident);
    }
  });
}

export async function retell(services: DeskServices, project: Project, now = Date.now()): Promise<string[]> {
  const { incidents } = services;
  const told: string[] = [];
  const nobody = incidents.transact(project, (incidents) =>
    Object.values(incidents.items)
      .filter((item) => item.open && item.held === "nobody" && item.told === undefined)
      .map((item) => ({ ...item })),
  );
  for (const seat of [...new Set(nobody.map((item) => item.seat))]) {
    const noticed = { id: seat, provider: nobody.find((item) => item.seat === seat)!.provider ?? "" };
    const place = placeOf(project, noticed);
    // Only once somebody is seated to read them; `deliver` then finds that somebody again.
    let reader: string | undefined;
    try {
      reader = await services.roster.supervisorFor(project, place.lane?.opener);
    } catch {
      // Nobody could be looked up: these stay held for nobody until a later round finds someone.
    }
    if (!reader || reader === seat) continue;
    const mine = nobody.filter((item) => item.seat === seat);
    const sending = incidents.transact(project, (incidents) => {
      const taken: Incident[] = [];
      for (const item of mine) {
        const incident = incidents.items[item.id];
        if (incident?.open && incident.held === "nobody" && tell(incident, now)) taken.push({ ...incident });
      }
      return taken;
    });
    if (sending.length > 0) told.push(...(await deliver(services, project, noticed, place, sending, now)));
  }
  return told;
}

export function closeIncidentsOf(services: DeskServices, project: Project, seat: string, now = Date.now()): string[] {
  return services.incidents.transact(project, (incidents) => closeSeat(incidents, seat, now));
}
