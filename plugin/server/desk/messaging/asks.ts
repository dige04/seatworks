import { can, roleNamed } from "../../catalog/kit/roles.ts";
import { ASK } from "../../domain/ask.ts";
import { askLetters } from "../letters/ask-letters.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import type { Ask } from "../../domain/ask.ts";
import { type Ledger, laneOfLead, nextAskId, taskOfPeer } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { conceptFile } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

type Asking = Pick<Ask, "from" | "fromRole" | "to" | "lane" | "task" | "kind" | "text" | "default">;

function newAsk(ledger: Ledger, asking: Asking): Ask {
  return { id: nextAskId(ledger), ...asking, status: "open", openedAt: Date.now(), reminders: 0 };
}

/** A Lead asks whoever supervises its lane, and works on its default while it waits. */
export async function askOwner(
  { ledgers, mail, roster }: Pick<DeskServices, "ledgers" | "mail" | "roster">,
  caller: Caller,
  asked: { kind: string; text: string; default: string },
): Promise<ToolReply> {
  const { project } = caller;
  const lane = laneOfLead(loadLedger(project.state), caller.id);
  if (!lane) return no("You have no open lane.");
  const reader = await roster.supervisorFor(project, lane.opener);
  // With nobody supervising seated it waits on the lane's opener, and the round hands it to whoever sits down first.
  const to = reader ?? lane.opener;
  // Opened on the lane the caller still leads: it may have closed while whoever answers was looked up.
  const entry = ledgers.transact(project, (ledger) => {
    if (laneOfLead(ledger, caller.id)?.id !== lane.id) return undefined;
    const from = { from: caller.id, fromRole: caller.role.role, to, lane: lane.id };
    const created = newAsk(ledger, { ...from, kind: asked.kind, text: asked.text, default: asked.default });
    ledger.asks[created.id] = created;
    return { ...created };
  });
  if (!entry) return no("You have no open lane.");
  if (reader) await mail.post(reader, askLetters.askTo(entry, `the Lead of ${lane.id} (${lane.title})`, "supervisor"));
  recordEvent(project, { kind: "ask.opened", ask: entry.id, from: caller.id, to });
  if (!reader)
    return ok(
      `Asked as ${entry.id}, but nobody supervising is seated: it goes to whoever sits down first. Keep working on your default and report when the lane is ready.`,
    );
  return ok(`Asked as ${entry.id}. Keep working on your default where you can; the answer arrives as mail.`);
}

/** A Peer or reviewer asks up: its Lead, or the level above when the Lead is gone; a best guess is its default. */
export async function askUp(
  { ledgers, mail, roster }: Pick<DeskServices, "ledgers" | "mail" | "roster">,
  caller: Caller,
  asked: { question: string; tried: string; guess?: string },
): Promise<ToolReply> {
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const task = taskOfPeer(ledger, caller.id);
  const lane = task ? ledger.lanes[task.lane] : undefined;
  if (!task || !lane?.lead) return no("Nobody is assigned to answer you; end your turn with the question.");
  // A gone Lead would never answer; it goes up a level instead, and the Peer is told so.
  const reader = (await roster.seated(lane.lead)) ? lane.lead : await roster.supervisorFor(project, lane.opener);
  // With nobody above seated it waits on the gone Lead, and the round hands it to whoever supervises once seated.
  const to = reader ?? lane.lead;
  const text = asked.tried ? `${asked.question}\n\nTried: ${asked.tried}` : asked.question;
  // Opened for the task the caller still holds, merged and kept included: it may have been cut meanwhile.
  const entry = ledgers.transact(project, (current) => {
    const now = taskOfPeer(current, caller.id);
    if (now?.id !== task.id || now.status === "cut") return undefined;
    const from = { from: caller.id, fromRole: caller.role.role, to, lane: lane.id, task: task.id };
    const created = newAsk(current, { ...from, kind: "question", text, default: asked.guess });
    current.asks[created.id] = created;
    return { ...created };
  });
  if (!entry) return no(`${task.id} was cut while you asked, so there is nothing to ask about; end your turn.`);
  recordEvent(project, { kind: "ask.opened", ask: entry.id, from: caller.id, to });
  if (!reader)
    return ok(
      `Asked as ${entry.id}, but your lead is not there and nobody above it is either, so nobody can answer now; it goes to whoever supervises once one sits down. Carry on with your default where you can, and end your turn.`,
    );
  const as = reader === lane.lead ? "lead" : "supervisor";
  const concept = conceptFile(project.state);
  await mail.post(reader, askLetters.askTo(entry, `the Peer on ${task.id} (${task.title})`, as, concept));
  const owner = reader === lane.lead ? "" : ", of the owner, because your lead is not there";
  return ok(`Asked as ${entry.id}${owner}. End your turn; the answer arrives as a message.`);
}

/**
 * Answers an open ask; one put to someone else may be answered by whoever supervises, and that seat is told first, as
 * is the Lead of a Peer answered past it.
 */
export async function answerAsk(
  { kit, ledgers, mail, roster }: Pick<DeskServices, "kit" | "ledgers" | "mail" | "roster">,
  caller: Caller,
  answered: { ask: string; text: string },
): Promise<ToolReply> {
  const id = answered.ask.toUpperCase();
  const { text } = answered;
  // Only whoever supervises reads incidents, so only its answer could carry one to a seat it is about: the asker, the
  // seat it was put to, and the Lead of a Peer answered past it each read the answer.
  if (can(caller.role, "supervise")) {
    const { state } = caller.project;
    const ledger = loadLedger(state);
    const ask = ledger.asks[id];
    const readers = [ask?.from, ask?.to, ask?.lane ? ledger.lanes[ask.lane]?.lead : undefined];
    const refused = readers
      .filter((seat) => seat !== caller.id)
      .map((seat) => repeatsIncident(state, seat, text))
      .find(Boolean);
    if (refused) return no(refused);
  }
  const result = ledgers.transact(caller.project, (ledger): { ask: Ask; waitingRole?: string } | string => {
    const ask = ledger.asks[id];
    if (!ask) return `There is no ask ${id}.`;
    if (!ASK.may(ask.status, "answer")) return `Ask ${id} is already answered.`;
    if (ask.to !== caller.id && !can(caller.role, "supervise")) return `Ask ${id} was not addressed to you.`;
    ASK.move(ask, "answer");
    ask.answer = text;
    return { ask: { ...ask }, waitingRole: ledger.agents[ask.to]?.role };
  });
  if (typeof result === "string") return no(result);
  const { ask } = result;
  const waiting = ask.to === caller.id ? undefined : ask.to;
  const waitingRole = roleNamed(kit, result.waitingRole ?? "");
  if (waiting) {
    const by = can(waitingRole, "supervise") ? `${caller.role.label} ${caller.id}` : "the owner";
    await mail.post(waiting, askLetters.answeredFor(ask, by, can(waitingRole, "lead")));
  }
  const lead = await leadPassed(roster, caller, ask, waiting);
  if (lead) await mail.post(lead, askLetters.answeredFor(ask, "the owner", true, false));
  const posted = await mail.post(ask.from, askLetters.answered(ask));
  recordEvent(caller.project, { kind: "ask.answered", ask: ask.id, by: caller.id, told: waiting ?? lead ?? null });
  const has = posted === "sent" ? "has it" : "reads it as soon as it can take it";
  const told = waiting ? " Whoever it was waiting on has been told what it was answered with." : "";
  const led = lead ? " Its lane's Lead has been told what it was answered with." : "";
  return ok(`Answered ${ask.id}; the asker ${has}.${told}${led}`);
}

/** The seated Lead of a Peer's lane that whoever supervises answered past, when the ask was put to another. */
async function leadPassed(
  roster: Pick<DeskServices["roster"], "seatedLead">,
  caller: Caller,
  ask: Ask,
  waiting: string | undefined,
): Promise<string | undefined> {
  if (!ask.task || !ask.lane || !can(caller.role, "supervise")) return undefined;
  const lead = await roster.seatedLead(loadLedger(caller.project.state).lanes[ask.lane]);
  return lead === caller.id || lead === waiting ? undefined : lead;
}
