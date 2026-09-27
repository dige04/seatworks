import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import { daemonLog } from "../../core/logger.ts";
import { HOUR_MS } from "../../core/time.ts";
import { type Project, projectOf } from "../../desk/project/project.ts";
import { recordEvent } from "../../desk/store/event-log.ts";
import { holdOn } from "../../desk/lanes/hold.ts";
import type { Rules } from "./outbox.ts";

/**
 * Mail waits on a seat's open call to the desk, its lane's hold and its agent's steering; a letter given up on is logged,
 * and recorded in the project `whose` its reader was, where that can be found: routine once seats go, so not an error.
 */
export function mailRules(
  kit: Kit,
  calling: (agentId: string) => boolean,
  whose: (agentId: string) => Project | undefined,
): Rules {
  return {
    dropped: (letter, at, why) => {
      daemonLog.info(
        `a letter for ${letter.to} (${letter.key}) was given up on after ${Math.round((at - letter.at) / HOUR_MS)} hours: ${why}`,
      );
      const project = whose(letter.to);
      if (project) recordEvent(project, { kind: "mail.dropped", to: letter.to, key: letter.key, why });
    },
    steers: (seat) => seatOf(kit, seat.provider)?.harness.steers === true,
    calling,
    holding: (seat) =>
      Boolean(
        seat.cwd && holdOn(projectOf(seat.cwd).state, seat.id, can(seatOf(kit, seat.provider)?.role, "supervise")),
      ),
  };
}
