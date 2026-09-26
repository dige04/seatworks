import { branchExists } from "../../core/git.ts";
import { keptFault } from "../../core/store.ts";
import { type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { humanSaid } from "../human/said.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { type ProjectConfig, type ProjectFields, readProjectConfig, saveConfig } from "./project.ts";

/**
 * Sets the project's standing configuration, each field left out kept as it is, refusing as open_lane does over a file it
 * could not read. While the Human is in the loop the Supervisor may only raise their standing orders.
 */
export async function setProject(
  { teamFor, roster }: Pick<DeskServices, "teamFor" | "roster">,
  caller: Caller,
  args: ProjectFields & { humanSaid?: string },
): Promise<ToolReply> {
  const read = readProjectConfig(caller.project.state);
  if ("fault" in read) return no(keptFault(read.fault).message);
  const { config } = read;
  const base = str(args.base);
  if (base && !(await branchExists(caller.project.root, base))) return no(`The branch ${base} does not exist.`);
  if (args.gateTimeoutMinutes !== undefined && !(args.gateTimeoutMinutes > 0))
    return no("Nothing was set: gateTimeoutMinutes is how long a gate may run, so it is more than 0.");
  const next: ProjectConfig = {
    base: base || config.base,
    gate: args.gate?.trim() ?? config.gate,
    gateTimeoutMinutes: args.gateTimeoutMinutes ?? config.gateTimeoutMinutes,
    gateOn: args.gateOn ?? config.gateOn,
    serialOnly: args.serialOnly ? strs(args.serialOnly) : config.serialOnly,
    landAs: args.landAs ?? config.landAs,
    laneHome: args.laneHome ?? config.laneHome,
    askFirst: args.askFirst ? strs(args.askFirst) : config.askFirst,
    riskRules: args.riskRules ?? config.riskRules,
  };
  const dropped = config.askFirst.filter((path) => !next.askFirst.includes(path));
  const moved = next.laneHome !== config.laneHome;
  if (teamFor(caller.project).hitl.on && (dropped.length > 0 || moved)) {
    const said = await humanSaid(roster, caller.id, str(args.humanSaid));
    const lowers = [
      ...(dropped.length > 0 ? [`take ${dropped.join(", ")} out of askFirst`] : []),
      ...(moved ? [`set where lanes work to ${next.laneHome}`] : []),
    ].join(" and ");
    if (!said)
      return no(
        `Nothing was set: to ${lowers} is the Human's while they are in the loop. Ask them, and pass their words from this chat as humanSaid, whole or twenty characters of a message.`,
      );
    recordEvent(caller.project, { kind: "orders.lowered", change: lowers, said, by: caller.id });
  }
  saveConfig(caller.project.state, next);
  const home = next.laneHome
    ? `lanes open as ${next.laneHome} unless a call says otherwise`
    : "where a lane opens is asked when the Human's copy makes it a question";
  const asked =
    next.askFirst.length > 0
      ? `a landing that touches ${next.askFirst.join(", ")} waits for the Human`
      : "no landing waits for the Human";
  const rules = next.riskRules ? `${next.riskRules.length} risk rules of its own` : "the kit's risk rules";
  return ok(
    `Base ${next.base ?? "unset"}; gate ${next.gate || "none"}, run per ${next.gateOn}; gate timeout ${next.gateTimeoutMinutes} minutes; lanes land as ${next.landAs}; ${home}; ${asked}; ${rules}.`,
  );
}
