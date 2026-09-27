import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { Seen, SeatView, Seats, Stream } from "../../core/ports.ts";
import { sentBy } from "../../core/sent-by.ts";
import { onDetail } from "./commands.ts";
import { type Fact, fact } from "../../domain/incident.ts";
import { Evasion, Recovery, Refusals, type Rules, onSettle, stuck } from "./facts.ts";
import { type HandedBack, contradicted, editBeforeLook, unverified } from "./turn-facts.ts";
import type { Quirks } from "../../catalog/kit/timeline.ts";
import { type Unit, Window } from "./window.ts";
import { daemonLog } from "../../core/logger.ts";

export type WatchedSeat = { id: string; provider: string; cwd: string; title?: string | null };

/** `thoughtless` counts the looks with words and no thinking while the seat has never shown any. */
export type SeatLook = {
  units: Unit[];
  facts: string[];
  since: number;
  instruction?: { text: string; from: string[] };
  thoughtless: number;
};

/**
 * `placed` is false until the ledger has placed the seat, or while it cannot be read; `handedBack` is the outcome and
 * summary of a hand-back since `at` the desk did not gate; `heard` whether the desk has ever had a call from the seat.
 */
export type SeatContext = {
  rules: Rules;
  handedBack: (at: number) => HandedBack | undefined;
  heard: () => boolean;
  placed: boolean;
};

type LongTurn = {
  longTurnMinutes: number;
  longTurnTimes: number;
  longTurnAfterTurns: number;
  longTurnMedianOf: number;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export class SeatWatch {
  readonly seat: WatchedSeat;
  readonly window: Window;
  private running = false;
  turnId: string | null = null;
  private startedAt = 0;
  private readonly durations: number[] = [];
  private readonly told = new Set<string>();
  private readonly recovery = new Recovery();
  private readonly refusals = new Refusals();
  private readonly evasion = new Evasion();
  private looked = 0;
  private lookedAt = Date.now();
  private readonly lookFacts = new Set<string>();
  private thoughtless = 0;
  private thinks = false;
  private readonly context: () => SeatContext | undefined;
  private current: SeatContext | undefined;

  constructor(seat: WatchedSeat, context: () => SeatContext | undefined, quirks?: Quirks) {
    this.seat = seat;
    this.context = context;
    this.window = new Window(quirks);
  }

  private rules(): Rules | undefined {
    return this.placed()?.rules;
  }

  see(seen: Exclude<Seen, { kind: "lost" }>, now = Date.now()): Fact[] {
    if (seen.kind === "idle") return this.idle();
    if (seen.kind === "reset") {
      this.window.clear();
      this.looked = 0;
      this.recovery.reset();
      this.refusals.reset();
      this.evasion.reset();
      this.told.clear();
      return [];
    }
    if (seen.kind === "turn") {
      if (seen.phase === "started") return this.started(seen.turnId, seen.at ?? now);
      if (this.running && this.turnId !== null && seen.turnId !== null && seen.turnId !== this.turnId) return [];
      return this.ended(seen.phase, now);
    }
    const { row } = seen;
    const end = this.window.end();
    const change = this.window.add(row);
    if (row.replay) {
      // Replayed history was read already, or said before the watch followed: no look reads it again.
      if (this.looked >= end) this.looked = this.window.end();
      return [];
    }
    if (row.item.type === "user_message") {
      this.recovery.reset();
      for (const key of [...this.told]) if (key !== "long-turn") this.told.delete(key);
      return [];
    }
    const rules = this.rules();
    if (!rules) return [];
    const call = change.call;
    const facts =
      !call || call.pseudo
        ? []
        : [
            ...(change.detailed ? onDetail(call, rules) : []),
            ...(change.settled ? onSettle(call, rules, (path) => this.lastRead(path, call.id)) : []),
          ];
    if (change.settled && change.call && !change.call.pseudo) {
      facts.push(
        ...this.recovery.step(change.call, rules),
        ...this.refusals.step(change.call, rules),
        ...this.evasion.step(change.call, rules),
      );
      const pattern = stuck(this.window.sinceInstruction(), rules);
      if (pattern) facts.push(fact("stuck", pattern));
      else this.told.delete("stuck");
    }
    return this.fresh(facts, change.call?.id);
  }

  lookDue(now: number, minutes: number): boolean {
    return this.running && now - Math.max(this.lookedAt, this.startedAt) >= minutes * 60_000;
  }

  /**
   * What the seat did since its last look, and the facts the code raised meanwhile. `final`, at a turn's end, reads to its
   * last word; while it runs, a thought or saying still being written waits for the next look.
   */
  look(now: number, final: boolean): SeatLook {
    const since = Math.max(this.lookedAt, this.startedAt);
    const { units, next } = this.window.since(this.looked, this.running && !final);
    this.looked = next;
    this.lookedAt = now;
    const facts = [...this.lookFacts];
    this.lookFacts.clear();
    if (units.some((unit) => unit.kind === "thought")) this.thinks = true;
    else if (!this.thinks && units.some((unit) => unit.kind === "said")) this.thoughtless += 1;
    return {
      units,
      facts,
      since,
      instruction: this.window.instruction(),
      thoughtless: this.thinks ? 0 : this.thoughtless,
    };
  }

  longTurn(now: number, long: LongTurn): Fact[] {
    if (this.durations.length > long.longTurnMedianOf)
      this.durations.splice(0, this.durations.length - long.longTurnMedianOf);
    if (!this.running || !this.startedAt) return [];
    const floor = long.longTurnMinutes * 60_000;
    const limit =
      this.durations.length >= long.longTurnAfterTurns
        ? Math.max(floor, long.longTurnTimes * median(this.durations))
        : floor;
    const took = now - this.startedAt;
    if (took < limit) return [];
    return this.fresh([
      fact(
        "long-turn",
        `running for ${Math.round(took / 60_000)} minutes, past the ${Math.round(limit / 60_000)} this seat's turns take`,
      ),
    ]);
  }

  private started(turnId: string | null, at: number): Fact[] {
    if (this.running && this.turnId === turnId && turnId !== null) return [];
    this.running = true;
    this.turnId = turnId;
    this.startedAt = at;
    this.current = this.context();
    this.told.clear();
    return [];
  }

  /** A turn whose end went unseen, as across a gap, is closed without judging how it ended. */
  private idle(): Fact[] {
    if (!this.running) return [];
    this.running = false;
    this.startedAt = 0;
    this.window.closeRunning();
    return [];
  }

  private ended(phase: "completed" | "failed" | "canceled", now: number): Fact[] {
    const since = this.startedAt;
    this.running = false;
    this.window.closeRunning();
    if (since) this.durations.push(now - since);
    this.startedAt = 0;
    const context = this.placed();
    if (phase !== "completed" || !context) return [];
    const handed = since ? context.handedBack(since) : undefined;
    const facts = [
      ...unverified(this.window, context.rules, handed !== undefined),
      ...contradicted(this.window, context.rules, handed),
      ...editBeforeLook(this.window, context.rules),
    ];
    const pattern = stuck(this.window.sinceInstruction(), context.rules);
    if (pattern) facts.push(fact("stuck", pattern));
    if (!context.heard()) facts.push(fact("desk-unreached", "ended a turn without one call to its team's tools"));
    return this.fresh(facts);
  }

  private lastRead(path: string, skip?: string): string | undefined {
    for (let index = this.window.units.length - 1; index >= 0; index--) {
      const unit = this.window.units[index]!;
      if (unit.kind !== "call" || unit.call.id === skip || unit.call.detail.filePath !== path) continue;
      if (unit.call.detail.type === "read" && typeof unit.call.detail.content === "string")
        return unit.call.detail.content;
      if (unit.call.detail.type === "write" && unit.call.ended && typeof unit.call.detail.content === "string")
        return unit.call.detail.content;
    }
    return undefined;
  }

  /** Re-read until the ledger places the seat: a Peer's first turn starts before the desk writes it onto its task. */
  private placed(): SeatContext | undefined {
    if (!this.current?.placed) this.current = this.context();
    return this.current;
  }

  private fresh(facts: Fact[], call?: string): Fact[] {
    const kept = facts.filter((fact) => {
      const key =
        fact.kind === "stuck" || fact.kind === "long-turn" || fact.kind === "unverified"
          ? fact.kind
          : `${fact.kind}\n${call ?? fact.quote}`;
      if (this.told.has(key)) return false;
      this.told.add(key);
      return true;
    });
    for (const fact of kept) this.lookFacts.add(fact.kind);
    return kept;
  }
}

type WatchDeps = {
  kit: Kit;
  seats: Seats;
  context: (seat: WatchedSeat) => SeatContext | undefined;
  found: (watch: SeatWatch, facts: Fact[]) => void;
  looked: (watch: SeatWatch, look: SeatLook) => void;
  /** A person wrote in the seat's own chat, past the desk: read off the followed stream, so only a watched role's chat is heard. */
  spoke: (seat: WatchedSeat, text: string) => void;
};

export class Watches {
  private readonly deps: WatchDeps;
  private readonly followed = new Map<string, { stream: Stream; watch: SeatWatch }>();

  constructor(deps: WatchDeps) {
    this.deps = deps;
  }

  watched(provider: string | null | undefined): boolean {
    return can(seatOf(this.deps.kit, provider)?.role, "watched");
  }

  get(id: string): SeatWatch | undefined {
    return this.followed.get(id)?.watch;
  }

  all(): SeatWatch[] {
    return [...this.followed.values()].map((entry) => entry.watch);
  }

  follow(seat: WatchedSeat): void {
    if (this.followed.has(seat.id) || !this.watched(seat.provider)) return;
    const watch = new SeatWatch(
      seat,
      () => this.deps.context(seat),
      seatOf(this.deps.kit, seat.provider)?.harness.timeline,
    );
    let stream: Stream;
    try {
      stream = this.deps.seats.watch(seat.id, (seen) => this.seen(watch, seen));
    } catch (error) {
      this.log(`${seat.id} could not be watched:`, error);
      return;
    }
    const entry = { stream, watch };
    this.followed.set(seat.id, entry);
    stream.ready.catch((error) => {
      if (this.followed.get(seat.id) === entry) this.followed.delete(seat.id);
      this.log(`${seat.id} could not be watched:`, error);
    });
  }

  drop(id: string): void {
    const entry = this.followed.get(id);
    if (!entry) return;
    this.followed.delete(id);
    entry.stream.stop();
  }

  sync(live: Iterable<SeatView>): void {
    const ids = new Set<string>();
    for (const seat of live) {
      if (seat.archivedAt) continue;
      if (this.watched(seat.provider)) ids.add(seat.id);
      this.follow(seat);
    }
    for (const id of [...this.followed.keys()]) if (!ids.has(id)) this.drop(id);
  }

  round(now: number, timing: (watch: SeatWatch) => LongTurn & { lookMinutes: number }): void {
    for (const { watch } of this.followed.values()) {
      const limits = timing(watch);
      this.found(watch, watch.longTurn(now, limits));
      if (watch.lookDue(now, limits.lookMinutes)) this.looked(watch, watch.look(now, false));
    }
  }

  dispose(): void {
    for (const id of [...this.followed.keys()]) this.drop(id);
  }

  /** A lost stream leaves the seat unfollowed, so the next round follows it again. */
  private seen(watch: SeatWatch, seen: Seen): void {
    if (
      seen.kind === "row" &&
      !seen.row.replay &&
      seen.row.item.type === "user_message" &&
      sentBy(seen.row.item)[0] === "person"
    ) {
      this.deps.spoke(watch.seat, typeof seen.row.item.text === "string" ? seen.row.item.text : "");
    }
    if (seen.kind !== "lost") {
      this.found(watch, watch.see(seen));
      // A turn's end is a look of its own, to the last word it wrote.
      if (seen.kind === "turn" && seen.phase !== "started") this.looked(watch, watch.look(Date.now(), true));
      return;
    }
    if (this.followed.get(watch.seat.id)?.watch === watch) this.followed.delete(watch.seat.id);
    this.log(`${watch.seat.id} is no longer watched: ${seen.error}`);
  }

  private found(watch: SeatWatch, facts: Fact[]): void {
    if (facts.length === 0) return;
    try {
      this.deps.found(watch, facts);
    } catch (error) {
      this.log(`what ${watch.seat.id} did could not be recorded:`, error);
    }
  }

  private looked(watch: SeatWatch, look: SeatLook): void {
    try {
      this.deps.looked(watch, look);
    } catch (error) {
      this.log(`what ${watch.seat.id} did could not be looked at:`, error);
    }
  }

  private log(line: string, error?: unknown): void {
    daemonLog.error(line, error);
  }
}
