import { availableParallelism, freemem, loadavg, totalmem } from "node:os";
import { midTurn } from "../../core/ports.ts";
import { plural } from "../../core/text.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { loadLedger } from "../store/ledger.ts";
import type { DeskServices } from "../services.ts";
import { seatPhrase } from "../views/report-seats.ts";

const MOST_MINUTES = 30;

const clock = (at: number) => new Date(at).toTimeString().slice(0, 5);

/**
 * What this machine is doing, read from the machine and not from anyone's word: its processors, load and memory, the
 * desk's gates and setups, the agents mid-turn in each project, and who holds it for measuring.
 */
async function machineText(
  { gates, machine, projects, roster }: Pick<DeskServices, "gates" | "machine" | "projects" | "roster">,
  now = Date.now(),
): Promise<string> {
  const load = loadavg().map((value) => value.toFixed(2));
  const gb = (bytes: number) => (bytes / 2 ** 30).toFixed(1);
  const { running, waiting } = gates.counts();
  const open = await roster.open();
  const busy = [...projects.values()].flatMap((project) => {
    const agents = loadLedger(project.state).agents;
    const count = open.filter((seat) => agents[seat.id] && midTurn(seat.status)).length;
    return count > 0 ? [`${project.slug} ${count}`] : [];
  });
  const held = machine.held(now);
  return [
    `${availableParallelism()} processors; load ${load.join(", ")} over 1, 5 and 15 minutes; ${gb(freemem())} GB of ${gb(totalmem())} GB free.`,
    `The desk runs ${running} ${plural(running, "gate or setup", "gates or setups")} now, and ${waiting} waiting for the machine.`,
    busy.length > 0 ? `Agents mid-turn: ${busy.join(", ")}.` : "No agent is mid-turn in any project.",
    held
      ? `Held for measuring by ${held.phrase} in ${held.project} until ${clock(held.until)}, for "${held.why}": no gate or setup starts meanwhile.`
      : "Nobody holds it for measuring.",
  ].join("\n");
}

/** Reads the machine, and with `hold` takes it for a measurement or, at 0, lets it go. */
export async function machineCall(
  desk: DeskServices,
  caller: Caller,
  args: { hold?: number; why?: string },
): Promise<ToolReply> {
  const now = Date.now();
  if (args.hold !== undefined && args.hold <= 0) {
    if (desk.machine.release(caller.id, now)) desk.gates.admit();
  } else if (args.hold !== undefined) {
    const minutes = Math.min(args.hold, MOST_MINUTES);
    const phrase = seatPhrase(desk.kit, loadLedger(caller.project.state), caller.id);
    const why = str(args.why) || "a measurement";
    const other = desk.machine.take(
      { seat: caller.id, phrase, project: caller.project.slug, until: now + minutes * 60_000, why },
      now,
    );
    if (other)
      return no(
        `The machine is held for measuring by ${other.phrase} in ${other.project} until ${clock(other.until)}, for "${other.why}": measure once it lets go, since two measurements at once spoil both.\n\n${await machineText(desk, now)}`,
      );
  }
  return ok(await machineText(desk, now));
}
