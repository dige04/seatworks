import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { isRecord } from "../../core/json.ts";
import { daemonLog } from "../../core/logger.ts";
import { stateRoot } from "../../core/paths.ts";
import { keptFault, readKept, writeJson } from "../../core/store.ts";

type Bound = Record<string, string>;

const isBound = (value: unknown): value is Bound =>
  isRecord(value) && Object.values(value).every((key) => typeof key === "string");

/**
 * Which agent each seat's key belongs to. A key is made as the seat is created, before Paseo names the agent, and bound
 * when it does; kept on disk, since a resumed seat's team server starts again with the key it was created with. A file that
 * cannot be read is never written over: binding a seat refuses it, and a key looked up in it is found by nobody.
 */
export class SeatKeys {
  private readonly file: string;
  /** The fault last reported, so a file that stays unreadable is reported once rather than at every look-up. */
  private told?: string;

  constructor() {
    this.file = join(stateRoot(), "keys.json");
  }

  issue(): string {
    return randomBytes(24).toString("hex");
  }

  bind(agent: string, key: string): void {
    const read = readKept<Bound>(this.file, {}, isBound);
    if ("fault" in read) throw keptFault(read.fault);
    writeJson(this.file, { ...read.value, [agent]: key });
  }

  keyOf(agent: string): string | undefined {
    return this.all()[agent];
  }

  agentOf(key: string): string | undefined {
    return key ? Object.entries(this.all()).find(([, held]) => held === key)?.[0] : undefined;
  }

  forget(agent: string): void {
    const read = readKept<Bound>(this.file, {}, isBound);
    if ("fault" in read || !(agent in read.value)) return;
    const { [agent]: _gone, ...rest } = read.value;
    writeJson(this.file, rest);
  }

  private all(): Bound {
    const read = readKept<Bound>(this.file, {}, isBound);
    if ("value" in read) {
      this.told = undefined;
      return read.value;
    }
    if (this.told !== read.fault) daemonLog.error(keptFault(read.fault).message);
    this.told = read.fault;
    return {};
  }
}
