import type { RiskRule } from "../../catalog/kit/schema/ecosystem.ts";
import { LAND_AS, branchExists } from "../../core/git.ts";
import { keptFault } from "../../core/store.ts";
import { type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { humanSaid } from "../human/said.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { type LaneHome, type ProjectConfig, readProjectConfig, saveConfig } from "./project.ts";

/** A set_project call as the tool takes it: each field left out keeps what the project has. */
type Settings = {
  base?: string;
  gate?: string;
  gateTimeoutMinutes?: number;
  gateOn?: "lane" | "task";
  serialOnly?: string[];
  landAs?: "squash" | "merge" | "ff";
  laneHome?: LaneHome;
  askFirst?: string[];
  riskRules?: RiskRule[];
  /** Their words asking for it, which lowering their standing orders needs while they are in the loop. */
  humanSaid?: string;
};

/**
 * Sets the project's standing configuration, refusing as open_lane does over a file it could not read. While the Human is
 * in the loop the Supervisor may only raise their standing orders: fewer paths asked about first, or another place lanes
 * work, takes their own words from this chat.
 */
export async function setProject(
  { teamFor, roster }: Pick<DeskServices, "teamFor" | "roster">,
  caller: Caller,
  args: Settings,
): Promise<ToolReply> {
  const read = readProjectConfig(caller.project.state);
  if ("fault" in read) return no(keptFault(read.fault).message);
  const { config } = read;
  const base = str(args.base);
  if (base && !(await branchExists(caller.project.root, base))) return no(`The branch ${base} does not exist.`);
  const minutes = Number(args.gateTimeoutMinutes);
  const next: ProjectConfig = {
    ...config,
    base: base || config.base,
    gate: typeof args.gate === "string" ? args.gate.trim() : config.gate,
    gateTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : config.gateTimeoutMinutes,
    gateOn: args.gateOn === "task" ? "task" : args.gateOn === "lane" ? "lane" : config.gateOn,
    serialOnly: Array.isArray(args.serialOnly) ? strs(args.serialOnly) : config.serialOnly,
    landAs: LAND_AS.find((as) => as === args.landAs) ?? config.landAs,
    laneHome: args.laneHome ?? config.laneHome,
    askFirst: Array.isArray(args.askFirst)
      ? strs(args.askFirst)
          .map((path) => path.trim())
          .filter(Boolean)
      : config.askFirst,
    riskRules: args.riskRules ?? config.riskRules,
  };
  const dropped = read.config.askFirst.filter((path) => !next.askFirst.includes(path));
  const moved = next.laneHome !== read.config.laneHome;
  if (teamFor(caller.project).hitl.on && (dropped.length > 0 || moved)) {
    const said = await humanSaid(roster, caller.id, str(args.humanSaid));
    const lowers = [
      ...(dropped.length > 0 ? [`take ${dropped.join(", ")} out of askFirst`] : []),
      ...(moved ? [`set where lanes work to ${next.laneHome ?? "asked each time"}`] : []),
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
