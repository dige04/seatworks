import { join } from "node:path";
import { runGate } from "../../core/gate.ts";
import type { Slot } from "../../domain/ledger.ts";
import type { DeskBase } from "../base.ts";
import { type Project, gitTimeout, loadConfig } from "../project/project.ts";

/** How the project's setup went in a copy it just made, for whoever works there first. */
export type SetUp = { command: string; ok: boolean; seconds: number; failed: string; logFile: string; tail: string };

/** The project's setup, run in a copy it just made before anyone works there, told which copy by its number. */
export async function setUpCopy(
  { log, stopping }: Pick<DeskBase, "log" | "stopping">,
  project: Project,
  slot: Pick<Slot, "id" | "path">,
): Promise<SetUp | undefined> {
  const { setup, gateTimeoutMinutes } = loadConfig(project.state);
  if (!setup) return undefined;
  const logFile = join(project.state, "gates", `setup-${slot.id}-${Date.now()}.log`);
  const copy = { SEATWORKS_COPY: slot.id.replace(/\D/g, "") };
  const run = await runGate(setup, slot.path, logFile, gitTimeout(project), stopping, copy);
  const failed = run.stopped
    ? "was stopped as the plugin stopped"
    : run.timedOut
      ? `timed out after ${gateTimeoutMinutes} minutes`
      : `failed with exit ${run.code}`;
  if (!run.ok) log(project, `setup in working copy ${slot.id} ${failed}; its log is ${logFile}`);
  return { command: setup, ok: run.ok, seconds: run.seconds, failed, logFile, tail: run.tail };
}
