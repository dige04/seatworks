import { TASK, DECIDED, type Task } from "../../domain/task.ts";
import { fact, findingsOf } from "../../domain/incident.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, taskOfPeer } from "../../domain/ledger.ts";
import { seatLetters } from "../letters/seat-letters.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { type Noticed, notice } from "../watch/notice.ts";

/**
 * A Peer's turn as the desk weighs it for silence: whether it reached the desk (`recorded`) or another seat (`spoke`),
 * whether a call of it is still in flight, and what its last call was, refused or unfinished, as read from its timeline.
 */
export type WorkerTurn = {
  seat: Noticed;
  text: string;
  recorded: boolean;
  spoke: boolean;
  calling: boolean;
  denied?: { what: string; refused: boolean };
  lastCall: string;
};

type Silence = Pick<DeskServices, "kit" | "ledgers" | "mail" | "roster" | "incidents" | "teamFor">;

/** A Peer's turn ended: heard from, or quiet, which is counted and nudged, then stalled and told. */
export async function workerEnded(desk: Silence, project: Project, ledger: Ledger, turn: WorkerTurn): Promise<void> {
  const task = taskOfPeer(ledger, turn.seat.id);
  if (!task) return;
  if (DECIDED.includes(task.status) && !turn.recorded) return;
  // Handed back, or its merge failed: what comes next is its Lead's call, so a quiet turn is no silence.
  if (turn.recorded || task.status === "done" || task.status === "failed")
    return heard(desk, project, task, turn.recorded, turn.spoke);
  // A call still in flight is not silence: a nudge here started a second gate beside the first.
  if (turn.calling) return;
  await silent(desk, project, ledger.lanes[task.lane], task, turn);
}

/** Heard from, so the quiet count restarts; left standing it was a lifetime tally. */
function heard(
  { ledgers }: Pick<DeskServices, "ledgers">,
  project: Project,
  task: Task,
  recorded: boolean,
  spoke: boolean,
): void {
  if (spoke && task.silent > 0)
    ledgers.setTask(project, task.id, (entry) => {
      entry.silent = 0;
    });
  // Nothing else sets a stalled task back to running once its Peer works again.
  if (recorded && task.status === "stalled")
    ledgers.moveTask(project, task.id, "resume", (entry) => {
      delete entry.peerGone;
    });
}

/** A turn ended with no hand-back and no ask: counted and nudged, then stalled and told to its Lead, and once to whoever supervises. */
async function silent(
  desk: Silence,
  project: Project,
  lane: Lane | undefined,
  task: Task,
  turn: WorkerTurn,
): Promise<void> {
  const { ledgers, mail, roster } = desk;
  const { silentTurns } = desk.teamFor(project).attention;
  const { denied } = turn;
  recordEvent(project, {
    kind: "turn.silent",
    task: task.id,
    denied: denied?.what ?? null,
    refused: denied?.refused ?? false,
    lastCall: turn.lastCall,
  });
  const updated = ledgers.setTask(project, task.id, (entry) => {
    entry.silent += 1;
    if (entry.silent >= silentTurns || denied) TASK.move(entry, "stall");
  });
  if (!updated) return;
  if (updated.status !== "stalled") {
    await mail.post(turn.seat.id, seatLetters.nudge(updated, "done"));
    return;
  }
  const reader = await roster.readerOf(project, lane);
  await mail.post(reader.to, seatLetters.stalled(task, turn.text, updated.silent, denied, reader.as));
  recordEvent(project, {
    kind: "task.silent",
    task: task.id,
    denied: denied?.what ?? null,
    refused: denied?.refused ?? false,
  });
  if (task.status === "stalled") return;
  const why = denied
    ? `its Peer's last call ${denied.refused ? "was refused" : "did not finish"}: ${denied.what}`
    : `its Peer ended ${updated.silent} turns without a hand-back or an ask`;
  await notice(desk, project, turn.seat, findingsOf([fact("stalled", why)]));
}
