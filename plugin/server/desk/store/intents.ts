import { isRecord } from "../../core/json.ts";
import { daemonLog } from "../../core/logger.ts";
import { keptFault, readKept, writeJson } from "../../core/store.ts";

/** A call a seat was told to stop waiting for: its answer was to come as mail. */
type Promised = { agent: string; tool: string; started: number };

type Kept = { archive: string[]; promised: Promised[] };

const same = (a: Promised, b: Promised) => a.agent === b.agent && a.tool === b.tool && a.started === b.started;

const isKept = (value: unknown): value is Kept =>
  isRecord(value) && Array.isArray(value.archive) && Array.isArray(value.promised);

/**
 * What the desk said it would do once a turn ends or a slow call finishes, on disk: a stop in between would forget it. A file
 * that cannot be read is read as holding nothing and never written over; its callers go on without waiting for it, so it is
 * reported rather than thrown.
 */
export class Intents {
  private readonly file: string;
  /** The fault last reported, so a file that stays unreadable is reported once rather than at every read. */
  private told?: string;

  constructor(file: string) {
    this.file = file;
  }

  private read(): Kept | undefined {
    const read = readKept<Kept>(this.file, { archive: [], promised: [] }, isKept);
    if ("value" in read) {
      this.told = undefined;
      return read.value;
    }
    if (this.told !== read.fault) daemonLog.error(keptFault(read.fault).message);
    this.told = read.fault;
    return undefined;
  }

  /** Writes what `change` makes of the file as it stands; nothing when it cannot be read, or when `change` changes nothing. */
  private change(change: (kept: Kept) => Kept | undefined): void {
    const kept = this.read();
    const next = kept && change(kept);
    if (next) writeJson(this.file, next);
  }

  toArchive(): string[] {
    return this.read()?.archive ?? [];
  }

  archiveLater(agentId: string): void {
    this.change((kept) =>
      kept.archive.includes(agentId) ? undefined : { ...kept, archive: [...kept.archive, agentId] },
    );
  }

  archived(agentId: string): void {
    this.change((kept) =>
      kept.archive.includes(agentId) ? { ...kept, archive: kept.archive.filter((id) => id !== agentId) } : undefined,
    );
  }

  promised(): Promised[] {
    return this.read()?.promised ?? [];
  }

  promise(promised: Promised): void {
    this.change((kept) =>
      kept.promised.some((entry) => same(entry, promised))
        ? undefined
        : { ...kept, promised: [...kept.promised, promised] },
    );
  }

  kept(promised: Promised): void {
    this.change((kept) =>
      kept.promised.some((entry) => same(entry, promised))
        ? { ...kept, promised: kept.promised.filter((entry) => !same(entry, promised)) }
        : undefined,
    );
  }
}
