import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import { daemonLog } from "../../core/logger.ts";
import { HOUR_MS } from "../../core/time.ts";
import { projectOf } from "../../desk/project/project.ts";
import { holdOn } from "../../desk/lanes/hold.ts";
import type { Rules } from "./outbox.ts";

/** Mail waits on a seat's open call to the desk, its lane's hold and its agent's steering; a letter given up on is logged. */
export function mailRules(kit: Kit, calling: (agentId: string) => boolean): Rules {
  return {
    dropped: (letter, at) =>
      daemonLog.error(
        `a letter for ${letter.to} (${letter.key}) was never taken and has been given up on after ${Math.round((at - letter.at) / HOUR_MS)} hours`,
      ),
    steers: (seat) => seatOf(kit, seat.provider)?.harness.steers === true,
    calling,
    holding: (seat) =>
      Boolean(
        seat.cwd && holdOn(projectOf(seat.cwd).state, seat.id, can(seatOf(kit, seat.provider)?.role, "supervise")),
      ),
  };
}
