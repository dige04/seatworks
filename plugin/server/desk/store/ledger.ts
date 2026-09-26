import { statSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../../core/errors.ts";
import { isRecord } from "../../core/json.ts";
import { readKept, writeJson } from "../../core/store.ts";
import { type Ledger, emptyLedger } from "../../domain/ledger.ts";

function ledgerFile(state: string): string {
  return join(state, "ledger.json");
}

/** A ledger missing a part is not one: read as empty, its numbering would give ids out again. */
const isLedger = (value: unknown): value is Ledger =>
  isRecord(value) &&
  isRecord(value.seq) &&
  Number.isInteger(value.seq.lane) &&
  Number.isInteger(value.seq.ask) &&
  Object.keys(emptyLedger()).every((part) => part === "seq" || isRecord(value[part]));

/** The ledger on disk from one read, or why it cannot be read: parsed as nothing, the next write would erase the project. */
export function readLedgerFile(state: string): { ledger: Ledger } | { fault: string } {
  const read = readKept(ledgerFile(state), emptyLedger(), isLedger);
  return "fault" in read ? read : { ledger: read.value };
}

/** The ledger, or throws why it cannot be read: never an empty one standing in for a file that is there. Absent is empty. */
export function loadLedger(state: string): Ledger {
  const read = readLedgerFile(state);
  if ("fault" in read)
    throw new Error(
      `${read.fault}. Nothing was read from it as if the project had no work on record. Only the Human can repair it or move it aside; no seat may write the desk's own files.`,
    );
  return read.ledger;
}

export function saveLedger(state: string, ledger: Ledger): void {
  cached.delete(state);
  writeJson(ledgerFile(state), ledger);
}

const cached = new Map<string, { mtimeMs: number; size: number; ledger: Ledger }>();

export function readLedger(state: string): Ledger {
  let stamp: { mtimeMs: number; size: number };
  try {
    stamp = statSync(ledgerFile(state));
  } catch {
    cached.delete(state);
    return emptyLedger();
  }
  const hit = cached.get(state);
  if (hit && hit.mtimeMs === stamp.mtimeMs && hit.size === stamp.size) return hit.ledger;
  const ledger = loadLedger(state);
  cached.set(state, { mtimeMs: stamp.mtimeMs, size: stamp.size, ledger });
  return ledger;
}

/**
 * Why this seat is held, as its Lead, a Peer or a reviewer: its lane's hold, or a ledger that cannot be read, which cannot say
 * the lane is free and so holds it too.
 */
export function holdOn(state: string, agentId: string): string | undefined {
  let ledger: Ledger;
  try {
    ledger = loadLedger(state);
  } catch (error) {
    return `The desk's record cannot be read, so whether your lane is on hold is not known: ${errorText(error)}`;
  }
  const lane = ledger.lanes[ledger.agents[agentId]?.lane ?? ""];
  return lane?.onHold && lane.status !== "closed" ? `Lane ${lane.id} is on hold: ${lane.onHold.reason}` : undefined;
}
