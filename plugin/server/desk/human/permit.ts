import { type Caller, type ToolReply, no, ok } from "../context.ts";
import { findLane } from "../../domain/ledger.ts";
import { seatLetters } from "../letters/seat-letters.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { loadLedger } from "../store/ledger.ts";

type PermitCall = { from: string; request: string; allow: boolean; why: string };

/**
 * Answers a Lead's or Peer's permission for the Human while they are out of the loop, by the task or lane its seat
 * works; a Peer's Lead is told, since the owner reached past it.
 */
export async function permit(
  { teamFor, roster, mail }: Pick<DeskServices, "teamFor" | "roster" | "mail">,
  caller: Caller,
  args: PermitCall,
): Promise<ToolReply> {
  const { project } = caller;
  if (teamFor(project).hitl.on)
    return no("While the Human is in the loop, a seat's permission is theirs to answer, in Paseo.");
  const ledger = loadLedger(project.state);
  const id = args.from.trim().toUpperCase();
  const task = ledger.tasks[id];
  const lane = task ? ledger.lanes[task.lane] : findLane(ledger, id);
  const seat = task ? task.peer : lane?.lead;
  if (!seat || !lane) return no(`There is no task or lane ${id} with a seat to answer for.`);
  const request = (await roster.look(seat)).pendingPermissions?.find((entry) => entry.id === args.request);
  if (!request)
    return no(`${id} is not waiting on permission ${args.request}: it was answered already, or never asked.`);
  await roster.respond(
    seat,
    args.request,
    args.allow ? { behavior: "allow" } : { behavior: "deny", message: args.why },
  );
  recordEvent(project, {
    kind: "permission.answered",
    agent: seat,
    request: args.request,
    allow: args.allow,
    by: caller.id,
  });
  if (task) await mail.post(lane.lead, seatLetters.permitted(task, request, args.allow, args.why));
  return ok(
    `${args.allow ? "Allowed" : "Refused"} ${id}'s permission ${args.request}${args.allow ? "" : "; it reads why"}.`,
  );
}
