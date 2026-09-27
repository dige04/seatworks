import { KeyedQueue } from "../../core/keyed-queue.ts";
import { type Posted, type SeatLook, type Seats, midTurn } from "../../core/ports.ts";
import { isRecord } from "../../core/json.ts";
import { daemonLog } from "../../core/logger.ts";
import { keptFault, readKept, writeJson } from "../../core/store.ts";

export type Letter = { id: string; to: string; key: string; text: string; at: number; wakes?: false };

const isLetter = (value: unknown): value is Letter =>
  isRecord(value) && typeof value.to === "string" && typeof value.at === "number";
type Compose = (seat: SeatLook, letters: Letter[]) => string;
/**
 * `steers`: the seat's harness takes a text into a running turn instead of replacing it; `calling`: the seat waits on a desk
 * call, where a text steered in reads as the call cut short; `delivered`: letters reached their seat, at `at`.
 */
export type Rules = {
  dropped?: (letter: Letter, now: number) => void;
  delivered?: (letters: Letter[], at: number) => void;
  steers?: (seat: SeatLook) => boolean;
  calling?: (agentId: string) => boolean;
  holding?: (seat: SeatLook) => boolean;
};

const KEEP_MS = 7 * 24 * 3_600_000;
const DUPLICATE_MS = 30 * 60_000;
const GRACE_MS = 10 * 60_000;
const SETTLE_MS = 60_000;

export class Outbox {
  private readonly file: string;
  private readonly compose: Compose;
  private readonly seats: Pick<Seats, "look" | "send">;
  private readonly rules: Rules;
  private readonly awaiting = new Map<string, number>();
  private readonly started = new Map<string, number>();
  private readonly sentKeys = new Map<string, number>();
  private readonly gone = new Set<string>();

  /** Keyed on the reader too: desk ids are unique only per project, and this one file serves them all. */
  private static keyOf(letter: { to: string; key: string }): string {
    return `${letter.to}\n${letter.key}`;
  }
  private readonly perSeat = new KeyedQueue();
  private counter = 0;

  constructor(file: string, compose: Compose, seats: Pick<Seats, "look" | "send">, rules: Rules = {}) {
    this.file = file;
    this.compose = compose;
    this.seats = seats;
    this.rules = rules;
  }

  /** Aged-out letters included, since both writers rebuild the file from this read; one that cannot be read throws. */
  letters(): Letter[] {
    const read = readKept<unknown[]>(this.file, [], Array.isArray);
    if ("fault" in read) throw keptFault(read.fault);
    return read.value.filter(isLetter);
  }

  /** The one place a letter is given up on, and it says so. */
  private keep(letters: Letter[], now: number): Letter[] {
    const kept: Letter[] = [];
    for (const letter of letters) {
      if (now - letter.at < KEEP_MS) kept.push(letter);
      else this.rules.dropped?.(letter, now);
    }
    for (const agent of this.gone) if (!kept.some((letter) => letter.to === agent)) this.gone.delete(agent);
    return kept;
  }

  private save(letters: Letter[]): void {
    writeJson(this.file, letters);
  }

  async post(letter: Omit<Letter, "id" | "at">): Promise<Posted> {
    const now = Date.now();
    const sentAt = this.sentKeys.get(Outbox.keyOf(letter));
    const waiting = this.letters();
    if (
      (sentAt !== undefined && now - sentAt < DUPLICATE_MS) ||
      waiting.some((entry) => entry.key === letter.key && entry.to === letter.to && now - entry.at < KEEP_MS)
    ) {
      return "duplicate";
    }
    const stored: Letter = { ...letter, id: `${now}-${process.pid}-${++this.counter}`, at: now };
    this.save([...this.keep(waiting, now), stored]);
    const sent = await this.pump(letter.to);
    return sent.has(stored.id) ? "sent" : "held";
  }

  /** A seat starting a turn is there to read, an archived one Paseo started again included. */
  turnStarted(agentId: string, now = Date.now()): void {
    this.started.set(agentId, now);
    this.gone.delete(agentId);
  }

  turnEnded(agentId: string): void {
    this.forget(agentId);
  }

  /** A seat Paseo archived takes nothing more: its mail waits for someone to pass it on, and it is not looked up again. */
  archived(agentId: string): void {
    this.forget(agentId);
    this.gone.add(agentId);
  }

  private forget(agentId: string): void {
    this.awaiting.delete(agentId);
    this.started.delete(agentId);
  }

  /** Every letter not yet sent, with when it is given up on: nothing else is sent a gone seat's mail. */
  held(): (Letter & { until: number })[] {
    return this.letters().map((letter) => ({ ...letter, until: letter.at + KEEP_MS }));
  }

  /** Takes back a letter its seat has not been sent, as one that says the same newer takes its place: whether it was still held. */
  withdraw(to: string, key: string): Promise<boolean> {
    return this.perSeat.run(to, async () => {
      const letters = this.letters();
      const kept = letters.filter((letter) => letter.to !== to || letter.key !== key);
      if (kept.length === letters.length) return false;
      this.save(kept);
      return true;
    });
  }

  pending(agentId: string): Letter[] {
    return this.letters().filter((letter) => letter.to === agentId);
  }

  pump(to: string): Promise<Set<string>> {
    return this.perSeat.run(to, async () => {
      const mine = this.pending(to);
      if (mine.length === 0 || this.gone.has(to)) return new Set<string>();
      // Held, not thrown: mail must not be lost, and one unanswerable address must not stop the round.
      const seat = await this.seats.look(to).catch(() => undefined);
      if (!seat) return new Set<string>();
      if (seat.archivedAt) {
        this.archived(to);
        return new Set<string>();
      }
      if ((seat.pendingPermissions?.length ?? 0) > 0) return new Set<string>();
      if (this.rules.holding?.(seat)) return new Set<string>();
      const since = this.awaiting.get(to);
      const waiting = since !== undefined && Date.now() - since < GRACE_MS;
      // A turn this desk never saw start — one running across a restart — is not known to be settled.
      const began = this.started.get(to);
      const steer =
        seat.status === "running" &&
        began !== undefined &&
        Date.now() - began >= SETTLE_MS &&
        this.rules.steers?.(seat) === true &&
        this.rules.calling?.(to) !== true;
      if (!steer && (midTurn(seat.status) || waiting)) return new Set<string>();
      // Word that asks nothing of an idle seat waits for a letter that does, or for a turn it is already in.
      if (!steer && mine.every((letter) => letter.wakes === false)) return new Set<string>();
      const text = this.compose(seat, mine);
      const kinds = [...new Set(mine.map((letter) => letter.key.split(":")[0]!))];
      try {
        await this.seats.send(to, text, kinds, steer ? "steer" : undefined);
      } catch (error) {
        // Kept for the next pump: what posted it has already happened, and a retry would do it twice.
        daemonLog.error(`mail for ${to} was not taken:`, error);
        return new Set<string>();
      }
      const now = Date.now();
      this.awaiting.set(to, now);
      const ids = new Set(mine.map((letter) => letter.id));
      for (const [key, at] of this.sentKeys) if (now - at >= DUPLICATE_MS) this.sentKeys.delete(key);
      for (const letter of mine) this.sentKeys.set(Outbox.keyOf(letter), now);
      this.save(this.letters().filter((letter) => !ids.has(letter.id)));
      this.rules.delivered?.(mine, now);
      return ids;
    });
  }
}
