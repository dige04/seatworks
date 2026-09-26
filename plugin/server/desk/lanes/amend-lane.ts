import { type Args, type Caller, type ToolReply, given, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import { amend } from "../../domain/amendment.ts";
import { findLane } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { workLetters } from "../letters/work-letters.ts";
import { serialIn } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { besideNote } from "./placement.ts";
import { recordEvent } from "../store/event-log.ts";
import { lanesBeside, tellBeside } from "./placement.ts";

/** Changes what an open or waiting lane is asked, keeping what it was asked before; its Lead is told what moved. */
export async function amendLane(
  { kit, ledgers, mail }: Pick<DeskServices, "kit" | "ledgers" | "mail">,
  caller: Caller,
  args: Args,
): Promise<ToolReply> {
  const { project } = caller;
  const changes = given(args, ["outcome"], ["acceptance", "outOfScope", "writeSet", "contracts"]);
  if (changes.outcome === "" || changes.acceptance?.length === 0)
    return no("A lane keeps an outcome and at least one acceptance line; give what it is asked now.");
  const lane = findLane(loadLedger(project.state), str(args.lane));
  if (!lane) return no(`There is no lane ${str(args.lane)}.`);
  const refused = repeatsIncident(project.state, lane.lead, str(args.why), ...Object.values(changes).flat());
  if (refused) return no(refused);
  const scoped = Boolean(changes.writeSet || changes.contracts);
  const serial = scoped ? await serialIn(kit, project, project.root) : [];
  const done = ledgers.transact(project, (current) => {
    const entry = current.lanes[lane.id];
    if (!entry || entry.status === "closed") return `Lane ${lane.id} is closed; ask for the work again with open_lane.`;
    const amendment = amend(entry, changes, caller.id, str(args.why));
    if (!amendment) return `Nothing about lane ${lane.id} would change; pass the fields it is asked differently now.`;
    delete entry.ready;
    // Read where it is written: a lane opened meanwhile may write what this one now does.
    const others = Object.values(current.lanes).filter((other) => other.status === "open" && other.id !== lane.id);
    const beside =
      entry.status === "open" && scoped ? lanesBeside(serial, others, entry.writeSet, entry.contracts) : [];
    return { lane: { ...entry }, amendment, beside };
  });
  if (typeof done === "string") return no(done);
  recordEvent(project, {
    kind: "lane.amended",
    lane: lane.id,
    fields: Object.keys(done.amendment.was),
    by: caller.id,
  });
  if (done.lane.status === "waiting") return ok(`Lane ${lane.id} is amended; it opens as it is now.`);
  const posted = await mail.post(done.lane.lead, workLetters.amended(done.lane, done.amendment, "lead"));
  await tellBeside({ mail }, project, done.lane, done.beside);
  const lanes = loadLedger(project.state).lanes;
  for (const { lane: id, paths } of done.beside) {
    const other = lanes[id];
    if (other) await mail.post(done.lane.lead, workLetters.laneBeside(other, paths));
  }
  return ok(
    `Lane ${lane.id} is amended${posted === "nobody" ? ", and it has no Lead to tell" : " and its Lead has the change"}; a READY it reported before no longer stands.${besideNote(done.beside, "now works")}`,
  );
}
