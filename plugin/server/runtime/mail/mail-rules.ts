import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import { daemonLog } from "../../core/logger.ts";
import type { SeatLook } from "../../core/ports.ts";
import { HOUR_MS } from "../../core/time.ts";
import { mailbox } from "../../desk/letters/envelope.ts";
import { projectOf } from "../../desk/project/project.ts";
import { holdOn, loadLedger } from "../../desk/store/ledger.ts";
import { openAsksTo } from "../../domain/ledger.ts";
import type { Letter, Rules } from "./outbox.ts";

/** What a seat is sent at once: its letters, and the asks still waiting on it where its project can be read. */
export function composeMail(seat: SeatLook, list: Letter[]): string {
  const items = list.map((letter) => letter.text);
  if (!seat.cwd) return mailbox(items, []);
  try {
    return mailbox(items, openAsksTo(loadLedger(projectOf(seat.cwd).state), seat.id));
  } catch {
    // A ledger that cannot be read holds back no letter: the asks are only a reminder beside them.
    return mailbox(items, []);
  }
}

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
