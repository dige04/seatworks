import { z } from "zod";
import { can } from "../../catalog/kit/roles.ts";
import { currentBranch, headSha, uncommittedPaths } from "../../core/git.ts";
import { hash } from "../../core/text.ts";
import { ok } from "../context.ts";
import { type Ledger, leadLaneOf } from "../../domain/ledger.ts";
import { SETTLED } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { loadConfig } from "../project/project.ts";
import { defineTool } from "../services.ts";
import { type OwnCheckout, statusText } from "../views/status.ts";

async function ownCopy(root: string): Promise<OwnCheckout> {
  const branch = await currentBranch(root);
  return { branch, head: branch ? undefined : (await headSha(root))?.slice(0, 7), work: await uncommittedPaths(root) };
}

/** One line that gives a seat its picture back though nothing changed: a seat whose context was compacted no longer holds it. */
function digest(ledger: Ledger, lane: string | undefined): string {
  const mine = <T extends { lane?: string }>(entry: T) => !lane || entry.lane === lane;
  const lanes = Object.values(ledger.lanes).filter((entry) => !lane || entry.id === lane);
  const named = (status: string) =>
    lanes
      .filter((entry) => entry.status === status)
      .map((entry) => entry.id)
      .join(", ") || "none";
  const tasks = Object.values(ledger.tasks).filter((task) => mine(task) && !SETTLED.includes(task.status));
  const asks = Object.values(ledger.asks).filter((ask) => mine(ask) && ask.status === "open").length;
  const working = tasks.map((task) => `${task.id} ${task.status}`).join(", ") || "none";
  return `Open lanes: ${named("open")}; waiting: ${named("waiting")}; tasks not settled: ${working}; open asks: ${asks}.`;
}

/** A supervisor also sees the Human's own checkout, read from git only here, when it asks. */
export const status = defineTool({
  name: "status",
  input: z.strictObject({}),
  async handle({ lastStatus, roster, teamFor }, caller) {
    const ledger = loadLedger(caller.project.state);
    const seats = new Map((await roster.open()).map((seat) => [seat.id, seat]));
    const led = can(caller.role, "lead") ? leadLaneOf(ledger, caller.id) : undefined;
    if (led?.status === "closed")
      return ok(
        `Lane ${led.id} (${led.title}) is closed${led.landed ? " and landed" : ""}. You are kept on with what you know of it until the owner releases you: nothing of it is yours to do.`,
      );
    const lane = led?.id;
    const copy = can(caller.role, "supervise") ? await ownCopy(caller.project.root) : undefined;
    const text = statusText(caller.project, ledger, loadConfig(caller.project.state), seats, Date.now(), {
      laneId: lane,
      copy,
      human: teamFor(caller.project).hitl.on,
      quoting: true,
    });
    if (lastStatus.get(caller.id) === hash(text))
      return ok(
        `Nothing has changed since you last asked. ${digest(ledger, lane)} End your turn: mail wakes you when something does.`,
      );
    lastStatus.set(caller.id, hash(text));
    return ok(text);
  },
});
