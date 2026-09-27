import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Kit } from "../catalog/kit/kit.ts";
import { watchPatterns } from "../catalog/kit/ecosystem-patterns.ts";
import { TEAM_SERVER } from "../catalog/kit/kit.ts";
import { seatOf } from "../catalog/kit/roles.ts";
import { errorText } from "../core/errors.ts";
import type { Desk } from "../desk/desk.ts";
import { laneOfLead, taskOfPeer } from "../domain/ledger.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import { type Project, gateCommands, projectOf, readProjectConfig } from "../desk/project/project.ts";
import type { TeamSource } from "./team-source.ts";
import type { Fact } from "../domain/incident.ts";
import { callsTo } from "./watch/facts.ts";
import type { SeatContext, SeatLook, SeatWatch, WatchedSeat, Watches } from "./watch/watches.ts";
import { daemonLog } from "../core/logger.ts";

type WatchingDeps = { kit: Kit; source: TeamSource; desk: Desk; watches: () => Watches };

/** Between the watch and the desk: what the watch reads of a seat, and what it noticed. */
export class Watching {
  private readonly deps: WatchingDeps;

  constructor(deps: WatchingDeps) {
    this.deps = deps;
  }

  context(seat: WatchedSeat): SeatContext | undefined {
    const found = seatOf(this.deps.kit, seat.provider);
    if (!found) return undefined;
    const project = projectOf(seat.cwd);
    const attention = this.deps.source.teamFor(project).attention;
    let scope: string[] | undefined;
    let placed = false;
    let ownCopy = false;
    try {
      const ledger = loadLedger(project.state);
      const task = taskOfPeer(ledger, seat.id);
      const lane = task ? ledger.lanes[task.lane] : laneOfLead(ledger, seat.id);
      scope = task?.kind !== "code" ? undefined : task.mode === "parallel" ? task.holds : lane?.writeSet;
      placed = Boolean(task ?? lane);
      // A slot is a copy the desk made; a lane without one works in the Human's own checkout.
      const copy = task?.slot ? task.worktree : lane?.slot && task?.mode !== "parallel" ? lane.worktree : undefined;
      ownCopy = copy !== undefined && resolve(copy) === resolve(seat.cwd);
    } catch (error) {
      this.deps.desk.event(project, { kind: "watch.unbriefed", agent: seat.id, error: errorText(error) });
    }
    const orders = readProjectConfig(project.state);
    if ("fault" in orders)
      this.deps.desk.event(project, { kind: "watch.unbriefed", agent: seat.id, error: orders.fault });
    return {
      placed,
      rules: {
        ...watchPatterns(this.deps.kit, attention),
        desk: callsTo(found.harness.mcpCall, found.harness.mcpServerField, TEAM_SERVER),
        gates: gateCommands(seat.cwd, "config" in orders ? orders.config.gate : undefined, this.deps.kit.ecosystem),
        cwd: seat.cwd,
        temp: tmpdir(),
        scope,
        ownCopy,
        repeatsAt: attention.repeatsAt,
        recoverWithin: attention.recoverWithin,
        refusalsAt: attention.refusalsAt,
        stuckWithin: attention.stuckWithin,
      },
      heard: () => {
        try {
          return loadLedger(project.state).agents[seat.id]?.recordedAt !== undefined;
        } catch {
          // A record that cannot be read cannot say the seat never reached it.
          return true;
        }
      },
      handedBack: (at) => {
        try {
          const handback = taskOfPeer(loadLedger(project.state), seat.id)?.handback;
          return handback && handback.at >= at && !handback.gate
            ? { outcome: handback.outcome, summary: handback.summary }
            : undefined;
        } catch {
          return undefined;
        }
      },
    };
  }

  private noticed(watch: SeatWatch, facts: Fact[]): void {
    if (this.deps.watches().get(watch.seat.id) !== watch) return;
    const project = projectOf(watch.seat.cwd);
    this.deps.desk
      .saw(project, watch.seat, facts, { instruction: watch.window.instruction(), turn: watch.turnId })
      .catch((error) => daemonLog.error("what the watch noticed could not be recorded:", error));
  }

  /** A seat whose agent shows the watch no thinking: what reads thinking is blind to it, recorded for whoever reads the log. */
  private blind(project: Project, watch: SeatWatch, look: SeatLook): void {
    const { seat } = watch;
    this.deps.desk.event(project, {
      kind: "watch.thoughtless",
      agent: seat.id,
      provider: seat.provider,
      looks: look.thoughtless,
    });
  }

  /** A look's new words go to the brains: the seat's own only, its thinking and what it said, never a tool's output. */
  looked(watch: SeatWatch, look: SeatLook): void {
    const project = projectOf(watch.seat.cwd);
    if (look.thoughtless === this.deps.source.teamFor(project).attention.thoughtlessLooks)
      this.blind(project, watch, look);
    const items = look.units.flatMap((unit) =>
      (unit.kind === "thought" || unit.kind === "said") && unit.text.trim()
        ? [{ kind: unit.kind, text: unit.text }]
        : [],
    );
    const { facts, since, instruction } = look;
    this.deps.desk
      .look(project, watch.seat, { items, facts, since, ...(instruction ? { instruction } : {}) })
      .catch((error) => daemonLog.error("what the watch looked at could not be read:", error));
  }

  found(watch: SeatWatch, facts: Fact[]): void {
    const project = projectOf(watch.seat.cwd);
    for (const fact of facts)
      this.deps.desk.event(project, {
        kind: "watch.fact",
        agent: watch.seat.id,
        fact: fact.kind,
        level: fact.level,
        quote: fact.quote,
      });
    this.noticed(watch, facts);
  }
}
