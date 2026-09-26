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
 * Which agent each seat's key belongs to, kept on disk since a resumed seat's server starts again with the key it was
 * created with. A file that cannot be read is never written over, and a seat showing its key then is refused with why.
 */
export class SeatKeys {
  private readonly file: string;
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
    const read = this.read();
    return "value" in read ? read.value[agent] : undefined;
  }

  /** Whose `key` is, or why the desk carries out nothing from the seat that shows it. */
  whose(key: string): { agent: string } | { refused: string } {
    const read = this.read();
    if ("fault" in read)
      return {
        refused: `${keptFault(read.fault).message} Until then the desk knows no seat by its key, so it carries out nothing from this one. Say so, and end your turn.`,
      };
    const agent = key ? Object.entries(read.value).find(([, held]) => held === key)?.[0] : undefined;
    return agent
      ? { agent }
      : {
          refused:
            "The desk does not know this agent's key: this agent was archived, and the desk serves no archived seat, so it carries out nothing from it. Say so, and end your turn.",
        };
  }

  forget(agent: string): void {
    const read = readKept<Bound>(this.file, {}, isBound);
    if ("fault" in read || !(agent in read.value)) return;
    const { [agent]: _gone, ...rest } = read.value;
    writeJson(this.file, rest);
  }

  private read(): { value: Bound } | { fault: string } {
    const read = readKept<Bound>(this.file, {}, isBound);
    if ("value" in read) this.told = undefined;
    else if (this.told !== read.fault) {
      daemonLog.error(keptFault(read.fault).message);
      this.told = read.fault;
    }
    return read;
  }
}
