import { headSha } from "../../core/git.ts";
import { errorText } from "../../core/errors.ts";
import type { LandOrder, Lane } from "../../domain/lane.ts";
import { type Ledger, tasksOf } from "../../domain/ledger.ts";
import { landLetters } from "../letters/land-letters.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { loadLedger } from "../store/ledger.ts";
import { closeLane } from "./closing.ts";

/** Carried out one at a time per project, apart from the landings they run, so a settled desk has none under way. */
export const orderKey = (project: Project) => `${project.slug}:ordered`;

/**
 * An ordered landing whose last writer's turn ended: landed for whoever asked, on the lane it judged, and they are told
 * how it went. One that meets another turn is ordered again by the landing itself, and tells nobody yet.
 */
export function carryOut(desk: DeskServices, project: Project, laneId: string, order: LandOrder): void {
  desk.landings
    .run(orderKey(project), async () => {
      const ledger = loadLedger(project.state);
      const lane = ledger.lanes[laneId];
      if (lane?.status !== "open") return;
      const changed = await changedSince(project, ledger, lane, order);
      if (changed) return void (await desk.mail.post(order.by, landLetters.calledOff(lane, changed, true)));
      const closed = await closeLane(desk, project, order.by, {
        lane: laneId,
        land: true,
        overGate: order.overGate,
        reason: order.reason,
      });
      const now = loadLedger(project.state).lanes[laneId];
      if (now?.landing) return;
      await desk.mail.post(order.by, landLetters.carried(lane, now?.status === "closed", closed.text));
    })
    .catch((error: unknown) =>
      desk.log(project, `the landing of ${laneId} ordered earlier failed: ${errorText(error)}`),
    );
}

/** What makes the lane other than what whoever ordered its landing judged, if anything does. */
async function changedSince(
  project: Project,
  ledger: Ledger,
  lane: Lane,
  order: LandOrder,
): Promise<string | undefined> {
  if (lane.onHold) return "it was put on hold";
  if ((await headSha(project.root, lane.branch)) !== order.tip) return "its branch moved";
  if (lane.ready?.at !== order.ready) return lane.ready ? "it was reported ready again" : "its READY was taken back";
  if ((lane.amended?.length ?? 0) !== order.amended) return "it was amended";
  // A review started since took the order back itself; one already reading when it was given may have come back.
  const back = tasksOf(ledger, lane.id).find((task) => task.kind === "review" && (task.handback?.at ?? 0) > order.at);
  return back ? `${back.id} came back, ending in ${back.handback!.outcome}` : undefined;
}
