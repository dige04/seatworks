import { covers, serialHits, uncovered } from "../../core/scope.ts";
import { capped } from "../../core/text.ts";
import { besideText } from "../lanes/placement.ts";
import { openWriters } from "../lanes/placement.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, besideOf } from "../../domain/ledger.ts";
import { AT_WORK, type Task } from "../../domain/task.ts";

const SHOWN = 10;

/**
 * What of a task's changed files its Lead should weigh, each file once: notes for the Lead, never a refusal. Once
 * `merged`, a Peer at work beside it whose hold it changed works from the lane as it was, which its Lead may tell it.
 */
export function reachNotes(
  ledger: Ledger,
  task: Task,
  lane: Lane,
  files: string[],
  serial: string[],
  merged = false,
): string[] {
  const notes: string[] = [];
  const taken = new Set<string>();
  for (const other of besideOf(ledger, task)) {
    const into = files.filter((file) => covers(other.holds, file));
    for (const file of into) taken.add(file);
    const stale =
      merged && AT_WORK.includes(other.status)
        ? "; its Peer works from the lane as it was until its hand-back brings this in, so tell it if its work depends on it"
        : "";
    if (into.length > 0)
      notes.push(`in what ${other.id} holds (${other.holds.join(", ")}): ${capped(into, SHOWN)}${stale}`);
  }
  const beyond = lane.writeSet.length > 0 ? uncovered(files, lane.writeSet).filter((file) => !taken.has(file)) : [];
  if (beyond.length > 0)
    notes.push(`outside the lane's write set (${lane.writeSet.join(", ")}): ${capped(beyond, SHOWN)}`);
  const lanes = openWriters(ledger, lane.id, serialHits(files, serial));
  if (lanes.length > 0)
    notes.push(`one writer at a time, and open lanes beside yours may write it too: ${besideText(lanes)}`);
  if (task.mode !== "parallel") return notes;
  const loose = uncovered(files, task.holds).filter((file) => !taken.has(file) && !beyond.includes(file));
  const oneWriter = new Set(serialHits(loose, serial));
  const named = loose.map((file) => (oneWriter.has(file) ? `${file} (one writer at a time)` : file));
  if (loose.length > 0) notes.push(`outside what it holds (${task.holds.join(", ")}): ${capped(named, SHOWN)}`);
  return notes;
}
