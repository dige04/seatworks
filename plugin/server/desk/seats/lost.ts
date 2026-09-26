import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { seatLetters } from "../letters/seat-letters.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";

/** A task whose Peer Paseo no longer lists: stalled with its Peer marked gone, and whoever reads for its lane told. */
export async function peerLost(
  { ledgers, roster, mail }: Pick<DeskServices, "ledgers" | "roster" | "mail">,
  project: Project,
  ledger: Ledger,
  task: Task,
): Promise<void> {
  const moved = ledgers.moveTask(project, task.id, "lose", (entry) => {
    entry.peerGone = true;
  });
  if (typeof moved !== "object") return;
  const reader = await roster.readerOf(project, ledger.lanes[task.lane]);
  await mail.post(reader.to, seatLetters.gone(task, reader.as));
}

/** A lane whose Lead Paseo no longer lists, which nothing restarts: whoever supervises is told; false with nobody to tell. */
export async function leadLost(
  { roster, mail }: Pick<DeskServices, "roster" | "mail">,
  project: Project,
  lane: Lane,
): Promise<boolean> {
  return (await mail.post(await roster.supervisorFor(project, lane.opener), seatLetters.leadGone(lane))) !== "nobody";
}
